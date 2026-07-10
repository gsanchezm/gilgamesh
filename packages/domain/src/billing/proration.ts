/**
 * Pure proration math (Clean Architecture — no framework imports). Slice 40: the SINGLE source both
 * payment arms consume so the mock and the Stripe adapter can never drift. Prices come from
 * `priceCents` (`./plans.ts`); time flows from the caller's injected `Clock` (never `Date.now`).
 */
import type { BillingCycle } from './plans';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nominal period length used to prorate — mirrors `ConfirmCheckout`'s 30-/365-day `currentPeriodEnd`. */
const PERIOD_DAYS: Record<BillingCycle, number> = { MONTHLY: 30, ANNUAL: 365 };

/**
 * Fraction of the current billing period still remaining, clamped to [0, 1]. `null` period end
 * (never checked out) → 0; a lapsed period → 0; a span longer than the nominal period → 1.
 */
export function remainingPeriodFraction(
  periodEnd: Date | null,
  billingCycle: BillingCycle,
  now: Date,
): number {
  if (!periodEnd) return 0;
  const remainingMs = periodEnd.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  const periodMs = PERIOD_DAYS[billingCycle] * DAY_MS;
  return Math.min(1, remainingMs / periodMs);
}

/**
 * Signed proration in cents for the remaining period: the delta between the target and current
 * prorated price. Positive = a charge (upgrade); negative = a credit (downgrade). Rounded to the
 * nearest cent. Passing `fromCents = 0` yields the plain unused-portion amount (used for refunds).
 */
export function prorationAmountCents(fromCents: number, toCents: number, fraction: number): number {
  return Math.round((toCents - fromCents) * fraction);
}
