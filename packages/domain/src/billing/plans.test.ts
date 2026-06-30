import { describe, expect, it } from 'vitest';
import { planLimits, priceCents } from './plans';

describe('planLimits (keystone §9)', () => {
  it('maps each plan to its run-minute quota + seat cap', () => {
    expect(planLimits('TEAM')).toEqual({ runMinutesQuota: 1000, maxSeats: 5, unlimited: false });
    expect(planLimits('PRO')).toMatchObject({ runMinutesQuota: 10000, maxSeats: 11, unlimited: false });
    expect(planLimits('ENTERPRISE').unlimited).toBe(true);
  });
});

describe('priceCents (keystone §9)', () => {
  it('returns the monthly price and a discounted annual price', () => {
    expect(priceCents('TEAM', 'MONTHLY')).toBe(19900);
    expect(priceCents('TEAM', 'ANNUAL')).toBe(16600);
    expect(priceCents('PRO', 'MONTHLY')).toBe(49900);
    expect(priceCents('PRO', 'ANNUAL')).toBeLessThan(priceCents('PRO', 'MONTHLY'));
    expect(priceCents('ENTERPRISE', 'MONTHLY')).toBe(0); // custom / contact sales
  });
});
