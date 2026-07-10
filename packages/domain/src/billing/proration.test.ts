import { describe, expect, it } from 'vitest';
import { prorationAmountCents, remainingPeriodFraction } from './proration';

const at = (iso: string) => new Date(iso);

describe('remainingPeriodFraction', () => {
  it('is 0 when there is no period end (never checked out)', () => {
    expect(remainingPeriodFraction(null, 'MONTHLY', at('2026-06-29T12:00:00.000Z'))).toBe(0);
  });

  it('is 0 when the period has already ended (clamped, never negative)', () => {
    const now = at('2026-07-30T12:00:00.000Z');
    expect(remainingPeriodFraction(at('2026-07-01T12:00:00.000Z'), 'MONTHLY', now)).toBe(0);
  });

  it('is a full half-period at the midpoint of a monthly cycle', () => {
    const now = at('2026-06-29T12:00:00.000Z');
    // 15 days remaining out of a 30-day monthly period → exactly 0.5.
    const end = at('2026-07-14T12:00:00.000Z');
    expect(remainingPeriodFraction(end, 'MONTHLY', now)).toBeCloseTo(0.5, 10);
  });

  it('is capped at 1 when the remaining span exceeds the nominal period', () => {
    const now = at('2026-06-29T12:00:00.000Z');
    // 60 days out on a 30-day period would be 2.0 → clamped to 1.
    const end = at('2026-08-28T12:00:00.000Z');
    expect(remainingPeriodFraction(end, 'MONTHLY', now)).toBe(1);
  });

  it('uses a 365-day nominal period for the annual cycle', () => {
    const now = at('2026-06-29T12:00:00.000Z');
    // ~182.5 days remaining of a 365-day annual period → ~0.5.
    const end = at('2026-12-28T12:00:00.000Z'); // 182 days later
    expect(remainingPeriodFraction(end, 'ANNUAL', now)).toBeCloseTo(182 / 365, 6);
  });
});

describe('prorationAmountCents', () => {
  it('is a positive charge when the target price is higher (upgrade)', () => {
    // (9900 - 2900) × 0.5 = 3500.
    expect(prorationAmountCents(2900, 9900, 0.5)).toBe(3500);
  });

  it('is a negative credit when the target price is lower (downgrade)', () => {
    // (2900 - 9900) × 0.5 = -3500.
    expect(prorationAmountCents(9900, 2900, 0.5)).toBe(-3500);
  });

  it('is zero when the fraction is zero (no time remaining)', () => {
    expect(prorationAmountCents(2900, 9900, 0)).toBe(0);
  });

  it('rounds to the nearest cent deterministically', () => {
    // (9900 - 2900) × (1/3) = 2333.33… → 2333.
    expect(prorationAmountCents(2900, 9900, 1 / 3)).toBe(2333);
  });

  it('yields a from=0 baseline (the unused-credit amount) as a plain rounded product', () => {
    // Refund of the unused portion of a 9900 price at fraction 0.5 → 4950.
    expect(prorationAmountCents(0, 9900, 0.5)).toBe(4950);
  });
});
