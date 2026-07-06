import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import type { SubscriptionRecord } from '../ports/records';
import { billableTokens, BRAIN_TOKENS_USED_CAP, BrainBilling } from './token-billing';

const subscription = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  id: 'sub-1',
  orgId: 'org-1',
  plan: 'FREE',
  billingCycle: 'MONTHLY',
  seats: 1,
  status: 'ACTIVE',
  runMinutesQuota: 500,
  runMinutesUsed: 0,
  brainTokensQuota: 100_000,
  brainTokensUsed: 0,
  providerCustomerId: null,
  providerSubscriptionId: null,
  currentPeriodEnd: null,
  ...overrides,
});

describe('billableTokens (owner decision S14-1)', () => {
  it('bills input + output and EXCLUDES cache read/create tokens', () => {
    expect(billableTokens({ inputTokens: 120, outputTokens: 80 })).toBe(200);
    expect(
      billableTokens({ inputTokens: 120, outputTokens: 80, cacheReadTokens: 9_999, cacheCreateTokens: 5_000 }),
    ).toBe(200);
  });
});

describe('BrainBilling (slice 14)', () => {
  let ctx: InMemoryContext;
  let billing: BrainBilling;

  beforeEach(() => {
    ctx = createInMemoryContext();
    billing = ctx.billing;
  });

  it('charge appends the BrainUsage row AND increments brainTokensUsed by the billable sum', async () => {
    await ctx.subscriptions.create(subscription());
    await billing.charge('org-1', 'CHAT', 'SONNET', {
      inputTokens: 30,
      outputTokens: 12,
      cacheReadTokens: 1_000,
    });

    const rows = await ctx.brainUsage.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surface: 'CHAT',
      tier: 'SONNET',
      inputTokens: 30,
      outputTokens: 12,
      cacheReadTokens: 1_000,
      cacheCreateTokens: 0,
    });
    // Cache tokens are recorded on the row but NEVER charged (S14-1).
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(42);
  });

  it('charge is unconditional — the last call may overshoot the quota and is recorded truthfully (§5.2)', async () => {
    await ctx.subscriptions.create(subscription({ brainTokensUsed: 99_990 }));
    await billing.charge('org-1', 'GENERATE', 'SONNET', { inputTokens: 100, outputTokens: 50 });
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(100_140);
    // ... and the NEXT call's pre-check blocks.
    expect(await billing.isExhausted('org-1')).toBe(true);
  });

  it('isExhausted gates at used >= quota on metered plans only', async () => {
    await ctx.subscriptions.create(subscription({ brainTokensUsed: 99_999 }));
    expect(await billing.isExhausted('org-1')).toBe(false);
    await billing.charge('org-1', 'EMBED', 'HAIKU', { inputTokens: 1, outputTokens: 0 });
    expect(await billing.isExhausted('org-1')).toBe(true);
  });

  it('SCALE is brainTokensUnlimited: never exhausted even at the saturation cap (AC-TOKB-06)', async () => {
    await ctx.subscriptions.create(
      subscription({ plan: 'SCALE', brainTokensQuota: 1_000_000_000, brainTokensUsed: BRAIN_TOKENS_USED_CAP }),
    );
    expect(await billing.isExhausted('org-1')).toBe(false);
    await expect(billing.assertWithinQuota('org-1')).resolves.toBeUndefined();
    await billing.charge('org-1', 'CHAT', 'SONNET', { inputTokens: 5, outputTokens: 5 });
    // Saturated counter (review S14 #2): charging past the cap clamps instead of overflowing int4 —
    // the charge transaction (and the chat send inside it) can never 500 on an unlimited-tier org.
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(BRAIN_TOKENS_USED_CAP);
  });

  it('chargeBrainTokens clamps exactly at BRAIN_TOKENS_USED_CAP on the boundary (review S14 #2)', async () => {
    await ctx.subscriptions.create(
      subscription({ plan: 'SCALE', brainTokensQuota: 1_000_000_000, brainTokensUsed: BRAIN_TOKENS_USED_CAP - 3 }),
    );
    await billing.charge('org-1', 'CHAT', 'SONNET', { inputTokens: 2, outputTokens: 1 });
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(BRAIN_TOKENS_USED_CAP);
    await billing.charge('org-1', 'CHAT', 'SONNET', { inputTokens: 10, outputTokens: 10 });
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(BRAIN_TOKENS_USED_CAP);
    // Metering never stops — only the counter saturates.
    expect(await ctx.brainUsage.listForOrg('org-1')).toHaveLength(2);
  });

  it('save() never persists the usage counters: a stale admin snapshot cannot clobber a concurrent charge (review S14 #1)', async () => {
    await ctx.subscriptions.create(subscription());
    // Admin flow reads its snapshot...
    const stale = (await ctx.subscriptions.findByOrg('org-1'))!;
    // ...a charge commits concurrently (tokens AND run minutes)...
    await billing.charge('org-1', 'CHAT', 'SONNET', { inputTokens: 30, outputTokens: 12 });
    expect(await ctx.subscriptions.chargeRunMinutes('org-1', 7)).toBe(true);
    // ...then the admin flow writes the stale record back (plan change semantics).
    await ctx.subscriptions.save({ ...stale, plan: 'GROWTH', brainTokensQuota: 10_000_000 });

    const after = (await ctx.subscriptions.findByOrg('org-1'))!;
    expect(after.plan).toBe('GROWTH'); // the admin write landed...
    expect(after.brainTokensQuota).toBe(10_000_000);
    expect(after.brainTokensUsed).toBe(42); // ...but the committed charges survived (no lost charge)
    expect(after.runMinutesUsed).toBe(7); // fixes the identical pre-existing slice-4 race too
  });

  it('no subscription row -> no metering, never blocked (the chargeRunMinutes precedent)', async () => {
    expect(await billing.isExhausted('ghost-org')).toBe(false);
    await expect(billing.assertWithinQuota('ghost-org')).resolves.toBeUndefined();
    // A charge still records the usage row; the counter increment is a no-op.
    await billing.charge('ghost-org', 'CHAT', 'SONNET', { inputTokens: 1, outputTokens: 1 });
    expect(await ctx.brainUsage.listForOrg('ghost-org')).toHaveLength(1);
  });

  it('assertWithinQuota throws QUOTA_EXCEEDED (-> 402) when exhausted (AC-TOKB-04)', async () => {
    await ctx.subscriptions.create(subscription({ brainTokensUsed: 100_000 }));
    await expect(billing.assertWithinQuota('org-1')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});
