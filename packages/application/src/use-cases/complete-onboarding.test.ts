import { beforeEach, describe, expect, it } from 'vitest';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';

async function newUser(ctx: InMemoryContext, email: string): Promise<string> {
  const res = await new RegisterUser(ctx).execute({
    firstName: 'I',
    lastName: 'U',
    email,
    password: 'C0rrect-Horse!',
  });
  return res.userId;
}

describe('CompleteOnboarding', () => {
  let ctx: InMemoryContext;
  let onboard: CompleteOnboarding;
  let userId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    onboard = new CompleteOnboarding(ctx);
    userId = await newUser(ctx, 'ishtar@uruk.io');
  });

  it('bootstraps the tenant on the first project (org, OWNER, 11 agents, TEAM trial, 5 slices, 11 awake bindings)', async () => {
    const { orgId, projectId, slug } = await onboard.execute({
      userId,
      projectName: 'OmniPizza',
      format: 'BDD',
      repoProvider: 'github',
      repoFullName: 'gsanchezm/omnipizza-web',
    });

    expect(slug).toBe('omnipizza');
    expect(await ctx.memberships.findRole(orgId, userId)).toBe('OWNER');
    expect(await ctx.agents.listForOrg(orgId)).toHaveLength(11);
    const sub = await ctx.subscriptions.findByOrg(orgId);
    expect(sub?.plan).toBe('TEAM');
    expect(sub?.status).toBe('TRIALING');
    expect(sub?.seats).toBe(5);
    expect((await ctx.projects.findById(projectId))?.format).toBe('BDD');
    expect(await ctx.slices.listForProject(projectId)).toHaveLength(5);
    const bindings = await ctx.toolBindings.listForProject(projectId);
    expect(bindings).toHaveLength(11);
    expect(bindings.every((b) => b.enabled)).toBe(true);
    expect(ctx.audit.rows.filter((r) => r.action === 'org.created')).toHaveLength(1);
    expect(ctx.audit.rows.filter((r) => r.action === 'project.created')).toHaveLength(1);
  });

  it('leaves repo fields null when the repo step is skipped', async () => {
    const { projectId } = await onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    const p = await ctx.projects.findById(projectId);
    expect(p?.repoProvider).toBeNull();
    expect(p?.repoFullName).toBeNull();
    expect(p?.repoBranch).toBeNull();
  });

  it('reuses the org on a second project (no new org/agents/subscription)', async () => {
    const first = await onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    const second = await onboard.execute({ userId, projectName: 'Voyager', format: 'TRADITIONAL' });
    expect(second.orgId).toBe(first.orgId);
    expect(await ctx.agents.listForOrg(first.orgId)).toHaveLength(11); // not 22
    expect(ctx.audit.rows.filter((r) => r.action === 'org.created')).toHaveLength(1);
    expect(await ctx.projects.listForOrg(first.orgId)).toHaveLength(2);
    expect(await ctx.toolBindings.listForProject(second.projectId)).toHaveLength(11);
  });

  it('auto-suffixes a colliding project slug within the org', async () => {
    await onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    const second = await onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    expect(second.slug).toBe('omnipizza-2');
  });

  it('auto-suffixes a colliding org slug across users', async () => {
    await onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    const other = await newUser(ctx, 'other@uruk.io');
    const res = await onboard.execute({ userId: other, projectName: 'OmniPizza', format: 'BDD' });
    expect((await ctx.orgs.findById(res.orgId))?.slug).toBe('omnipizza-2');
  });

  it('rejects an empty project name', async () => {
    await expect(onboard.execute({ userId, projectName: '   ', format: 'BDD' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('forbids a VIEWER of an existing org from creating a project', async () => {
    const now = ctx.clock.now();
    await ctx.orgs.create({ id: 'org-x', name: 'X', slug: 'x', createdAt: now, updatedAt: now });
    const viewer = await newUser(ctx, 'viewer@uruk.io');
    await ctx.memberships.create({ id: 'm-x', orgId: 'org-x', userId: viewer, role: 'VIEWER', createdAt: now });
    await expect(onboard.execute({ userId: viewer, projectName: 'Nope', format: 'BDD' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
