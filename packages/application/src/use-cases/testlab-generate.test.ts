import { parseFeature } from '@gilgamesh/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GenerateDrafts } from './testlab-generate';
import { RegisterUser } from './register-user';

describe('Test Lab — AI generate (stub brain)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const onboarded = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  it('returns parseable BDD feature drafts and persists nothing (AC-GEN-01/02)', async () => {
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'checkout flow', count: 2 });

    expect(drafts.testCases).toEqual([]);
    expect(drafts.features).toHaveLength(1);
    const parsed = parseFeature(drafts.features[0]!.content);
    expect(parsed.scenarios).toHaveLength(2);

    // Nothing was written to the lab.
    expect(await ctx.features.listForProject(projectId)).toEqual([]);
    expect(await ctx.testCases.listForProject(projectId)).toEqual([]);

    // Audited without the raw prompt text.
    const audited = ctx.audit.rows.find((r) => r.action === 'testlab.generated');
    expect(audited?.metadata).toMatchObject({ features: 1, promptLength: 'checkout flow'.length });
    expect(JSON.stringify(audited?.metadata)).not.toContain('checkout flow');
  });

  it('is deterministic and offline (same input -> same output) (AC-GEN-02)', async () => {
    const a = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'same', count: 3 });
    const b = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'same', count: 3 });
    expect(a).toEqual(b);
  });

  it('generates traditional test-case drafts with valid priority', async () => {
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'login', format: 'TRADITIONAL', count: 3 });
    expect(drafts.features).toEqual([]);
    expect(drafts.testCases).toHaveLength(3);
    expect(drafts.testCases.every((t) => ['HIGH', 'MEDIUM', 'LOW'].includes(t.priority))).toBe(true);
  });

  it('rejects an empty prompt (VALIDATION)', async () => {
    await expect(new GenerateDrafts(ctx).execute({ userId, projectId, prompt: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('enforces authz: outsider NOT_FOUND, viewer FORBIDDEN (AC-GEN-03)', async () => {
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(
      new GenerateDrafts(ctx).execute({ userId: outsider, projectId, prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(
      new GenerateDrafts(ctx).execute({ userId: viewer, projectId, prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
