import { describe, expect, it } from 'vitest';
import { planLimits, priceCents } from './plans';

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
});
