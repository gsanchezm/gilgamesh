import { describe, expect, it } from 'vitest';
import {
  ANNUAL_MONTHS_FREE,
  annualTotalCents,
  displayPriceCents,
  PLAN_CATALOG,
  planTier,
} from './plan-catalog';

describe('PLAN_CATALOG', () => {
  it('lists the four public tiers in upgrade order', () => {
    expect(PLAN_CATALOG.map((t) => t.id)).toEqual(['free', 'starter', 'growth', 'scale']);
  });

  it('prices the tiers per the owner model (monthly, in cents)', () => {
    expect(planTier('free').monthlyCents).toBe(0);
    expect(planTier('starter').monthlyCents).toBe(2900);
    expect(planTier('growth').monthlyCents).toBe(9900);
    expect(planTier('scale').monthlyCents).toBe(49900);
  });

  it('marks Growth as the highlighted ("most popular") tier and nothing else', () => {
    expect(PLAN_CATALOG.filter((t) => t.highlight).map((t) => t.id)).toEqual(['growth']);
  });

  it('bills the annual total as 10 months (2 months free)', () => {
    expect(ANNUAL_MONTHS_FREE).toBe(2);
    expect(annualTotalCents(planTier('starter'))).toBe(29000); // $290/yr
    expect(annualTotalCents(planTier('growth'))).toBe(99000); // $990/yr
    expect(annualTotalCents(planTier('scale'))).toBe(499000); // $4,990/yr
    expect(annualTotalCents(planTier('free'))).toBe(0);
  });

  it('shows the annual price as the per-month-equivalent (annual total / 12), rounded', () => {
    // $29 → $24.17/mo billed annually · $499 → $415.83 → matches the prototype ($416).
    expect(displayPriceCents(planTier('starter'), 'annual')).toBe(2417);
    expect(displayPriceCents(planTier('scale'), 'annual')).toBe(41583);
  });

  it('leaves the monthly display price untouched and never charges Free', () => {
    expect(displayPriceCents(planTier('growth'), 'monthly')).toBe(9900);
    expect(displayPriceCents(planTier('free'), 'annual')).toBe(0);
  });

  it('makes annual cheaper per month than monthly for every paid tier', () => {
    for (const tier of PLAN_CATALOG.filter((t) => t.monthlyCents > 0)) {
      expect(displayPriceCents(tier, 'annual')).toBeLessThan(tier.monthlyCents);
    }
  });

  it('exposes the Scale per-extra-workspace add-on price', () => {
    expect(planTier('scale').perExtraWorkspaceCents).toBe(9900);
    // Only Scale meters extra workspaces.
    expect(planTier('growth').perExtraWorkspaceCents).toBeUndefined();
  });

  it('gives every tier a CTA and every paid tier an "everything in X" preface', () => {
    expect(planTier('free').ctaLabel.length).toBeGreaterThan(0);
    expect(planTier('free').inheritsFromName).toBeNull();
    expect(planTier('starter').inheritsFromName).toBe('Everything in Free, plus');
    expect(planTier('scale').features.length).toBeGreaterThan(0);
  });
});
