import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import type { SubscriptionRecord } from '../ports/records';
import { ResetBillingUsage } from './billing-rollover';

const subscription = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: 'sub-1',
  orgId: 'org-1',
  plan: 'STARTER',
  billingCycle: 'MONTHLY',
  seats: 3,
  status: 'ACTIVE',
  runMinutesQuota: 5_000,
  runMinutesUsed: 250,
  brainTokensQuota: 2_000_000,
  brainTokensUsed: 73_000,
  providerCustomerId: 'cus_123',
  providerSubscriptionId: 'sub_123',
  currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

describe('ResetBillingUsage (slice 21, closes S14-6)', () => {
  let ctx: InMemoryContext;
  let rollover: ResetBillingUsage;

  beforeEach(() => {
    ctx = createInMemoryContext();
    rollover = new ResetBillingUsage({ subscriptions: ctx.subscriptions });
  });

  it('AC-ROLL-01: zeroes BOTH counters together for the targeted org', async () => {
    await ctx.subscriptions.create(subscription());
    const { reset } = await rollover.execute({ orgId: 'org-1' });

    expect(reset).toBe(1);
    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });

  it('AC-ROLL-02: leaves every other subscription field untouched', async () => {
    const before = subscription();
    await ctx.subscriptions.create(before);
    await rollover.execute({ orgId: 'org-1' });

    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after).toMatchObject({
      id: before.id,
      orgId: before.orgId,
      plan: before.plan,
      billingCycle: before.billingCycle,
      seats: before.seats,
      status: before.status,
      runMinutesQuota: before.runMinutesQuota,
      brainTokensQuota: before.brainTokensQuota,
      providerCustomerId: before.providerCustomerId,
      providerSubscriptionId: before.providerSubscriptionId,
      currentPeriodEnd: before.currentPeriodEnd,
    });
    // ...and only the two counters moved.
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });

  it('AC-ROLL-03: resetting all orgs zeroes every org and counts every row', async () => {
    await ctx.subscriptions.create(subscription({ id: 'sub-1', orgId: 'org-1', runMinutesUsed: 100, brainTokensUsed: 9_000 }));
    await ctx.subscriptions.create(subscription({ id: 'sub-2', orgId: 'org-2', runMinutesUsed: 480, brainTokensUsed: 5_000 }));
    await ctx.subscriptions.create(subscription({ id: 'sub-3', orgId: 'org-3', plan: 'SCALE', runMinutesUsed: 4, brainTokensUsed: 2_000_000_000 }));

    const { reset } = await rollover.execute();

    expect(reset).toBe(3);
    for (const orgId of ['org-1', 'org-2', 'org-3']) {
      const after = (await ctx.subscriptions.findByOrg(orgId))!;
      expect(after.runMinutesUsed).toBe(0);
      expect(after.brainTokensUsed).toBe(0);
    }
  });

  it('AC-ROLL-03: a targeted reset zeroes ONLY that org, leaving the others intact', async () => {
    await ctx.subscriptions.create(subscription({ id: 'sub-1', orgId: 'org-1', runMinutesUsed: 100, brainTokensUsed: 9_000 }));
    await ctx.subscriptions.create(subscription({ id: 'sub-2', orgId: 'org-2', runMinutesUsed: 480, brainTokensUsed: 5_000 }));

    const { reset } = await rollover.execute({ orgId: 'org-1' });

    expect(reset).toBe(1);
    const org1 = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(org1.runMinutesUsed).toBe(0);
    expect(org1.brainTokensUsed).toBe(0);
    const org2 = (await ctx.subscriptions.findByOrg('org-2'))!;
    expect(org2.runMinutesUsed).toBe(480);
    expect(org2.brainTokensUsed).toBe(5_000);
  });

  it('AC-ROLL-04: is idempotent — resetting an already-zero org keeps it at zero and still matches the row', async () => {
    await ctx.subscriptions.create(subscription({ runMinutesUsed: 0, brainTokensUsed: 0 }));

    const first = await rollover.execute({ orgId: 'org-1' });
    const second = await rollover.execute({ orgId: 'org-1' });

    expect(first.reset).toBe(1);
    expect(second.reset).toBe(1); // parity with Postgres: a no-change UPDATE still counts the matched row
    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });

  it('AC-ROLL-05: resetting an org with no subscription row is a harmless no-op (0 rows)', async () => {
    const { reset } = await rollover.execute({ orgId: 'ghost-org' });
    expect(reset).toBe(0);
  });

  it('AC-ROLL-06: a charge after the reset counts against the new period (reset-then-charge)', async () => {
    await ctx.subscriptions.create(subscription({ runMinutesUsed: 100, brainTokensUsed: 40_000 }));

    await rollover.execute({ orgId: 'org-1' });
    // The new period's charges accumulate from zero.
    expect(await ctx.subscriptions.chargeRunMinutes('org-1', 5)).toBe(true);
    await ctx.subscriptions.chargeBrainTokens('org-1', 1_200);

    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after.runMinutesUsed).toBe(5);
    expect(after.brainTokensUsed).toBe(1_200);
  });

  it('AC-ROLL-06: a charge before the reset is cleared with the period (charge-then-reset)', async () => {
    await ctx.subscriptions.create(subscription({ runMinutesUsed: 0, brainTokensUsed: 0 }));

    expect(await ctx.subscriptions.chargeRunMinutes('org-1', 42)).toBe(true);
    await ctx.subscriptions.chargeBrainTokens('org-1', 3_333);
    await rollover.execute({ orgId: 'org-1' });

    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });
});
