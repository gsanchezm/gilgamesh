import { describe, expect, it } from 'vitest';
import { prorationAmountCents, quoteRefund, remainingPeriodFraction } from './proration';

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

describe('quoteRefund (slice 41)', () => {
  it('quotes a valid partial refund unchanged, within the ceiling', () => {
    // A $50 refund against a $99 paid invoice.
    expect(quoteRefund(5000, 9900)).toEqual({ refundableCents: 9900, amountCents: 5000, exceedsCeiling: false });
  });

  it('quotes a full refund of the ceiling when no amount is requested', () => {
    expect(quoteRefund(undefined, 9900)).toEqual({ refundableCents: 9900, amountCents: 9900, exceedsCeiling: false });
  });

  it('flags a request beyond the ceiling and clamps the previewed amount down', () => {
    // The previewed amount is clamped (informational); execute uses exceedsCeiling to reject.
    expect(quoteRefund(20000, 9900)).toEqual({ refundableCents: 9900, amountCents: 9900, exceedsCeiling: true });
  });

  it('quotes exactly the ceiling as a valid (boundary) request', () => {
    expect(quoteRefund(9900, 9900)).toEqual({ refundableCents: 9900, amountCents: 9900, exceedsCeiling: false });
  });

  it('quotes zero for a non-positive request (never a negative refund)', () => {
    expect(quoteRefund(0, 9900)).toEqual({ refundableCents: 9900, amountCents: 0, exceedsCeiling: false });
    expect(quoteRefund(-100, 9900)).toEqual({ refundableCents: 9900, amountCents: 0, exceedsCeiling: false });
  });

  it('rounds the ceiling and request to whole cents and never goes below zero', () => {
    expect(quoteRefund(1200.6, 5000.4)).toEqual({ refundableCents: 5000, amountCents: 1201, exceedsCeiling: false });
    // A negative ceiling (never expected) clamps to a zero ceiling; any request then exceeds it.
    expect(quoteRefund(10, -5)).toEqual({ refundableCents: 0, amountCents: 0, exceedsCeiling: true });
  });

  it('quotes zero for a zero ceiling with no request (nothing refundable, not an over-refund)', () => {
    expect(quoteRefund(undefined, 0)).toEqual({ refundableCents: 0, amountCents: 0, exceedsCeiling: false });
  });
});
