import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GetOrgSubscription } from './org-queries';
import { RegisterUser } from './register-user';
import { GetRun, ListRuns, TriggerRun } from './runs';
import { CreateFeature } from './testlab-features';
import { CreateTestCase } from './testlab-testcases';

describe('Test Execution — runs', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const o = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = o.orgId;
    projectId = o.projectId;
  });

  const makeFeature = () =>
    new CreateFeature(ctx).execute({
      userId,
      projectId,
      path: 'checkout.feature',
      content:
        'Feature: Checkout\n  Scenario: Pay with card\n    When pay\n  Scenario: Payment fails\n    When pay\n  Scenario: Refund wip\n    When refund\n',
    });

  it('runs a feature, aggregates results, persists + reads the run (AC-RUN-01/04/05/07)', async () => {
    const f = await makeFeature();
    const run = await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id });

    expect(run).toMatchObject({ status: 'FAILED', passed: 1, failed: 1, skipped: 1, total: 3, ratePct: 33 });
    expect(run.results.map((r) => r.status)).toEqual(['PASS', 'FAIL', 'SKIP']);
    expect(ctx.audit.rows.some((r) => r.action === 'run.created')).toBe(true);

    const got = await new GetRun(ctx).execute({ userId, runId: run.id });
    expect(got.results).toHaveLength(3);
    expect(got.status).toBe('FAILED');
  });

  it('runs a single test case (AC-RUN-02)', async () => {
    const tc = await new CreateTestCase(ctx).execute({ userId, projectId, title: 'Login works', priority: 'HIGH' });
    const run = await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'TESTCASE', targetId: tc.id });
    expect(run).toMatchObject({ status: 'DONE', passed: 1, total: 1 });
    expect(run.results).toHaveLength(1);
  });

  it('reflects the latest result onto scenarios + lists runs newest-first (AC-RUN-06/08)', async () => {
    const f = await makeFeature();
    await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id });
    const scenarios = await ctx.scenarios.listForFeature(f.id);
    expect(scenarios.map((s) => s.lastStatus)).toEqual(['PASS', 'FAIL', 'SKIPPED']);

    const r2 = await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id });
    const list = await new ListRuns(ctx).execute({ userId, projectId });
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(r2.id);
  });

  it('charges run minutes and blocks when the quota is exhausted (AC-SUB-07)', async () => {
    const f = await makeFeature(); // 3 scenarios -> cost 3
    await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id });
    expect((await new GetOrgSubscription(ctx).execute({ userId, orgId })).runMinutesUsed).toBe(3);

    // Exhaust the quota through the charge path (save() no longer persists the counters —
    // review S14 #1), then the next run is blocked.
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.chargeRunMinutes(orgId, sub.runMinutesQuota - sub.runMinutesUsed);
    await expect(
      new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('rejects a missing / foreign target (AC-RUN-12)', async () => {
    await expect(
      new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: 'nope' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces tenant isolation + viewer RBAC (AC-RUN-10/11)', async () => {
    const f = await makeFeature();
    const run = await new TriggerRun(ctx).execute({ userId, projectId, targetKind: 'FEATURE', targetId: f.id });

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetRun(ctx).execute({ userId: outsider, runId: run.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(new ListRuns(ctx).execute({ userId: outsider, projectId })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    expect((await new ListRuns(ctx).execute({ userId: viewer, projectId })).length).toBe(1);
    await expect(
      new TriggerRun(ctx).execute({ userId: viewer, projectId, targetKind: 'FEATURE', targetId: f.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
