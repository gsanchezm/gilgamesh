import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { GetBrainUsage } from './brain-usage';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';

describe('GetBrainUsage — per-org token usage view', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    orgId = (await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })).orgId;
  });

  const seed = (surface: 'CHAT' | 'ROUTER' | 'GENERATE', tier: 'HAIKU' | 'SONNET', rowOrgId = orgId) =>
    ctx.brainUsage.append({
      id: ctx.ids.next(),
      orgId: rowOrgId,
      tier,
      surface,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      createdAt: ctx.clock.now(),
    });

  it('aggregates the org rows per tier and surface (AC-METER-03)', async () => {
    await seed('ROUTER', 'HAIKU');
    await seed('CHAT', 'SONNET');
    await seed('CHAT', 'SONNET');
    const view = await new GetBrainUsage(ctx).execute({ userId, orgId });
    expect(view.totals).toMatchObject({ calls: 3, inputTokens: 30, outputTokens: 15 });
    expect(view.bySurface.find((s) => s.surface === 'CHAT')).toMatchObject({ calls: 2 });
    expect(view.byTier.map((t) => t.tier)).toEqual(['HAIKU', 'SONNET']);
  });

  it('is tenant-isolated and viewer-readable (AC-METER-03/04)', async () => {
    await seed('CHAT', 'SONNET', 'someone-elses-org');
    const view = await new GetBrainUsage(ctx).execute({ userId, orgId });
    expect(view.totals.calls).toBe(0);

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(new GetBrainUsage(ctx).execute({ userId: viewer, orgId })).resolves.toBeTruthy();

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@nippur.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetBrainUsage(ctx).execute({ userId: outsider, orgId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
