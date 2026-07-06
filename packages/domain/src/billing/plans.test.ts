import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG } from '../pricing/plan-catalog';
import { type Plan, planLimits, priceCents } from './plans';

describe('planLimits', () => {
  it('maps each plan to active workspace, service and execution limits', () => {
    expect(planLimits('FREE')).toMatchObject({
      runMinutesQuota: 500,
      maxSeats: 1,
      maxServicesPerWorkspace: 2,
      unlimited: false,
    });
    expect(planLimits('STARTER')).toMatchObject({
      runMinutesQuota: 5000,
      maxServicesPerWorkspace: 5,
      maxUsersPerWorkspace: 3,
      unlimited: false,
    });
    expect(planLimits('GROWTH')).toMatchObject({
      runMinutesQuota: 25000,
      maxServicesPerWorkspace: 15,
      unlimited: false,
    });
    expect(planLimits('SCALE')).toMatchObject({
      includedWorkspaces: 10,
      unlimited: true,
    });
  });

  // Slice 14 (AC-TOKB-01): the keystone §9 AI token allowances, derived — never re-stated.
  it('maps each plan to its monthly AI Brain token allowance', () => {
    expect(planLimits('FREE')).toMatchObject({ brainTokensQuota: 100_000, brainTokensUnlimited: false });
    expect(planLimits('STARTER')).toMatchObject({ brainTokensQuota: 2_000_000, brainTokensUnlimited: false });
    expect(planLimits('GROWTH')).toMatchObject({ brainTokensQuota: 10_000_000, brainTokensUnlimited: false });
    expect(planLimits('SCALE')).toMatchObject({ brainTokensQuota: 1_000_000_000, brainTokensUnlimited: true });
  });
});

describe('priceCents', () => {
  it('returns the monthly price and a two-months-free annual equivalent', () => {
    expect(priceCents('FREE', 'MONTHLY')).toBe(0);
    expect(priceCents('STARTER', 'MONTHLY')).toBe(2900);
    expect(priceCents('STARTER', 'ANNUAL')).toBe(2417);
    expect(priceCents('GROWTH', 'MONTHLY')).toBe(9900);
    expect(priceCents('GROWTH', 'ANNUAL')).toBeLessThan(priceCents('GROWTH', 'MONTHLY'));
  });

  it('prices Scale add-on workspaces beyond the 10 included', () => {
    expect(priceCents('SCALE', 'MONTHLY', 10)).toBe(49900);
    expect(priceCents('SCALE', 'MONTHLY', 12)).toBe(69700);
  });

  it('prices annual as 10 charged months, workspace-aware for Scale (AC-B4T-03/04)', () => {
    expect(priceCents('GROWTH', 'ANNUAL')).toBe(8250); // round(9900 * 10 / 12)
    expect(priceCents('SCALE', 'ANNUAL', 12)).toBe(58083); // round(69700 * 10 / 12)
  });
});

// Slice 10 (AC-B4T): PLAN_CATALOG is the SINGLE source of truth — the billing rules
// derive every number (prices, add-on, limits) from the catalog's structured fields.
describe('derivation from PLAN_CATALOG (single source)', () => {
  const UNLIMITED_WORKSPACES = 1_000_000;
  const UNLIMITED_EXECUTIONS = 1_000_000_000;
  const UNLIMITED_TOKENS = 1_000_000_000;
  const cap = (v: number | 'unlimited', c: number) => (v === 'unlimited' ? c : v);

  it('derives every price from the catalog', () => {
    for (const tier of PLAN_CATALOG) {
      const plan = tier.id.toUpperCase() as Plan;
      expect(priceCents(plan, 'MONTHLY')).toBe(tier.monthlyCents);
      const extra = tier.perExtraWorkspaceCents ?? 0;
      expect(priceCents(plan, 'MONTHLY', tier.limits.includedWorkspaces + 3)).toBe(
        tier.monthlyCents + 3 * extra,
      );
    }
  });

  it('derives every limit from the catalog structured limits', () => {
    for (const tier of PLAN_CATALOG) {
      const l = planLimits(tier.id.toUpperCase() as Plan);
      expect(l.runMinutesQuota).toBe(cap(tier.limits.executionsPerMonth, UNLIMITED_EXECUTIONS));
      expect(l.maxSeats).toBe(cap(tier.limits.workspaces, UNLIMITED_WORKSPACES));
      expect(l.maxServicesPerWorkspace).toBe(cap(tier.limits.servicesPerWorkspace, UNLIMITED_WORKSPACES));
      expect(l.maxUsersPerWorkspace).toBe(cap(tier.limits.usersPerWorkspace, UNLIMITED_WORKSPACES));
      expect(l.includedWorkspaces).toBe(tier.limits.includedWorkspaces);
      expect(l.unlimited).toBe(tier.limits.executionsPerMonth === 'unlimited');
      // Slice 14: the AI token allowance derives from the same structured limits (single source).
      expect(l.brainTokensQuota).toBe(cap(tier.limits.aiTokensPerMonth, UNLIMITED_TOKENS));
      expect(l.brainTokensUnlimited).toBe(tier.limits.aiTokensPerMonth === 'unlimited');
    }
  });
});
