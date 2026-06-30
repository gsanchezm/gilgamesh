/**
 * Pure billing rules (Clean Architecture — no framework imports). Plan limits + pricing per the
 * keystone §9 mock reference. `Plan`/`BillingCycle` are the keystone string unions (structurally
 * identical to the application records' copies, so they interoperate without a cross-layer import).
 */
export type Plan = 'TEAM' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface PlanLimits {
  runMinutesQuota: number;
  maxSeats: number;
  unlimited: boolean;
}

const LIMITS: Record<Plan, PlanLimits> = {
  TEAM: { runMinutesQuota: 1000, maxSeats: 5, unlimited: false },
  PRO: { runMinutesQuota: 10000, maxSeats: 11, unlimited: false },
  // 1e9 (not MAX_SAFE_INTEGER) so the quota fits Postgres int4; `unlimited` is the real signal.
  ENTERPRISE: { runMinutesQuota: 1_000_000_000, maxSeats: 1000, unlimited: true },
};

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}

// §9: TEAM $199/mo ($166 yr) · PRO $499/mo ($416 yr) · ENTERPRISE custom. Values in cents; the annual
// figure is the per-month-equivalent when billed annually (≈16% off). ENTERPRISE = 0 = contact sales.
const PRICING: Record<Plan, { monthly: number; annual: number }> = {
  TEAM: { monthly: 19900, annual: 16600 },
  PRO: { monthly: 49900, annual: 41600 },
  ENTERPRISE: { monthly: 0, annual: 0 },
};

export function priceCents(plan: Plan, cycle: BillingCycle): number {
  const p = PRICING[plan];
  return cycle === 'ANNUAL' ? p.annual : p.monthly;
}
