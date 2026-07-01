/**
 * Pure billing rules (Clean Architecture — no framework imports). The current business model bills by
 * active workspace/month and keeps the legacy quota columns as execution counters until the storage
 * model is expanded.
 */
export type Plan = 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface PlanLimits {
  /** Stored in `runMinutesQuota` until the subscription schema is renamed. */
  runMinutesQuota: number;
  /** Active workspaces allowed. 1_000_000 is the practical "unlimited" cap for validation/storage. */
  maxSeats: number;
  maxServicesPerWorkspace: number;
  maxUsersPerWorkspace: number;
  includedWorkspaces: number;
  unlimited: boolean;
}

const LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    runMinutesQuota: 500,
    maxSeats: 1,
    maxServicesPerWorkspace: 2,
    maxUsersPerWorkspace: 1,
    includedWorkspaces: 1,
    unlimited: false,
  },
  STARTER: {
    runMinutesQuota: 5_000,
    maxSeats: 1_000_000,
    maxServicesPerWorkspace: 5,
    maxUsersPerWorkspace: 3,
    includedWorkspaces: 1,
    unlimited: false,
  },
  GROWTH: {
    runMinutesQuota: 25_000,
    maxSeats: 1_000_000,
    maxServicesPerWorkspace: 15,
    maxUsersPerWorkspace: 1_000_000,
    includedWorkspaces: 1,
    unlimited: false,
  },
  // 1e9 fits Postgres int4 and is only a storage guard; `unlimited` is the real signal.
  SCALE: {
    runMinutesQuota: 1_000_000_000,
    maxSeats: 1_000_000,
    maxServicesPerWorkspace: 1_000_000,
    maxUsersPerWorkspace: 1_000_000,
    includedWorkspaces: 10,
    unlimited: true,
  },
};

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}

const ANNUAL_MONTHS_CHARGED = 10;

// Values in cents. Annual returns the per-month equivalent when billed annually (2 months free).
const PRICING: Record<Plan, { monthly: number; extraWorkspaceMonthly: number }> = {
  FREE: { monthly: 0, extraWorkspaceMonthly: 0 },
  STARTER: { monthly: 2900, extraWorkspaceMonthly: 0 },
  GROWTH: { monthly: 9900, extraWorkspaceMonthly: 0 },
  SCALE: { monthly: 49900, extraWorkspaceMonthly: 9900 },
};

export function priceCents(plan: Plan, cycle: BillingCycle, activeWorkspaces = 1): number {
  const p = PRICING[plan];
  const limits = LIMITS[plan];
  const extraWorkspaces =
    p.extraWorkspaceMonthly > 0 ? Math.max(0, activeWorkspaces - limits.includedWorkspaces) : 0;
  const monthly = p.monthly + extraWorkspaces * p.extraWorkspaceMonthly;
  return cycle === 'ANNUAL' ? Math.round((monthly * ANNUAL_MONTHS_CHARGED) / 12) : monthly;
}
