import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import {
  ConnectIntegration,
  DisconnectIntegration,
  ImportRepoFeatures,
  ListIntegrations,
} from './integrations';
import { RegisterUser } from './register-user';

const TOKEN = 'ghp_secret_token_value';

describe('Integrations — connect a source repo (stub provider)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'O', lastName: 'W', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const onboarded = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  it('lists the full catalog disconnected initially (AC-INT-01; +AI_PROVIDERS since keystone v0.3)', async () => {
    const list = await new ListIntegrations(ctx).execute({ userId, orgId });
    expect(list.map((i) => i.key)).toEqual(['github', 'gitlab', 'bitbucket', 'ado_repos', 'anthropic']);
    expect(list.every((i) => i.connected === false)).toBe(true);
  });

  it('connects with a token, stores only a vault ref, leaks no token (AC-INT-02/09)', async () => {
    const view = await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: TOKEN });
    expect(view).toMatchObject({ key: 'github', connected: true });
    expect(JSON.stringify(view)).not.toContain(TOKEN);

    const row = await ctx.integrations.findByKey(orgId, 'github');
    expect(row?.secretRef).toBe(`vault://${orgId}/github`);
    expect(JSON.stringify(row)).not.toContain(TOKEN);

    const audited = ctx.audit.rows.find((r) => r.action === 'integration.connected');
    expect(audited?.metadata).toEqual({ key: 'github' });
    expect(JSON.stringify(audited)).not.toContain(TOKEN);

    const list = await new ListIntegrations(ctx).execute({ userId, orgId });
    expect(list.find((i) => i.key === 'github')?.connected).toBe(true);
  });

  it('rejects an empty token or an unknown key (AC-INT-03)', async () => {
    await expect(new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: '   ' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(new ConnectIntegration(ctx).execute({ userId, orgId, key: 'jira', token: TOKEN })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('disconnects, clearing the vault ref (AC-INT-04)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: TOKEN });
    const view = await new DisconnectIntegration(ctx).execute({ userId, orgId, key: 'github' });
    expect(view.connected).toBe(false);
    expect((await ctx.integrations.findByKey(orgId, 'github'))?.secretRef).toBeNull();
  });

  it('enforces authz: non-member NOT_FOUND, viewer FORBIDDEN (AC-INT-05)', async () => {
    const outsider = (await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })).userId;
    await expect(new ConnectIntegration(ctx).execute({ userId: outsider, orgId, key: 'github', token: TOKEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(new ConnectIntegration(ctx).execute({ userId: viewer, orgId, key: 'github', token: TOKEN })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('imports .feature files from the connected repo and links the project (AC-INT-06)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: TOKEN });
    const res = await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' });
    expect(res.imported).toBe(2);
    expect(res.features.map((f) => f.path).sort()).toEqual(['features/checkout.feature', 'features/login.feature']);

    const features = await ctx.features.listForProject(projectId);
    expect(features).toHaveLength(2);

    const project = await ctx.projects.findById(projectId);
    expect(project).toMatchObject({ repoProvider: 'github', repoFullName: 'acme/web-app', repoBranch: 'main' });
    expect(project?.repoLastSyncAt).not.toBeNull();
  });

  it('re-import is idempotent — upserts by path, no duplicates (AC-INT-07)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: TOKEN });
    await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' });
    await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' });
    expect(await ctx.features.listForProject(projectId)).toHaveLength(2);
  });

  it('re-import upserts by path, preserving feature ids (AC-INT-07)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'github', token: TOKEN });
    await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' });
    const before = (await ctx.features.listForProject(projectId)).map((f) => f.id).sort();
    await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' });
    const after = (await ctx.features.listForProject(projectId)).map((f) => f.id).sort();
    expect(after).toEqual(before); // same ids -> upserted in place, not recreated
  });

  it('rejects import without a connected source repo (AC-INT-08)', async () => {
    await expect(new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/web-app', branch: 'main' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('maps ado_repos -> ado on the project (AC-INT-06 enum map)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'ado_repos', token: TOKEN });
    await new ImportRepoFeatures(ctx).execute({ userId, projectId, fullName: 'acme/api', branch: 'main' });
    expect((await ctx.projects.findById(projectId))?.repoProvider).toBe('ado');
  });
});
