/**
 * Pure billing rules (Clean Architecture — no framework imports). Slice 10: every number here
 * DERIVES from the canonical PLAN_CATALOG (`../pricing/plan-catalog.ts`) — prices, the Scale
 * per-extra-workspace add-on, and the structured tier limits. The business bills by active
 * workspace/month; the legacy `Subscription` columns are kept with remapped semantics
 * (owner decision S10): `seats` = active workspaces, `runMinutes*` = monthly executions.
 */
import {
  ANNUAL_MONTHS_CHARGED,
  PLAN_CATALOG,
  type PlanTier,
  type PlanTierLimit,
} from '../pricing/plan-catalog';

export type Plan = 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface PlanLimits {
  /** Monthly executions. Stored in `runMinutesQuota` until the subscription schema is renamed. */
  runMinutesQuota: number;
  /** Active workspaces allowed. 1_000_000 is the practical "unlimited" cap for validation/storage. */
  maxSeats: number;
  maxServicesPerWorkspace: number;
  maxUsersPerWorkspace: number;
  includedWorkspaces: number;
  unlimited: boolean;
  /** Monthly AI Brain token allowance (keystone §9, slice 14) — `Subscription.brainTokensQuota`. */
  brainTokensQuota: number;
  /** True when the tier's AI token allowance is uncapped (SCALE) — blocking is bypassed, metering isn't. */
  brainTokensUnlimited: boolean;
}

// Storage caps for 'unlimited' (both fit Postgres int4); the `unlimited` flag is the real signal.
const UNLIMITED_CAP = 1_000_000;
const UNLIMITED_EXECUTIONS_CAP = 1_000_000_000;
const UNLIMITED_TOKENS_CAP = 1_000_000_000;

const capped = (limit: PlanTierLimit, cap: number): number => (limit === 'unlimited' ? cap : limit);

function deriveLimits(tier: PlanTier): PlanLimits {
  return {
    runMinutesQuota: capped(tier.limits.executionsPerMonth, UNLIMITED_EXECUTIONS_CAP),
    maxSeats: capped(tier.limits.workspaces, UNLIMITED_CAP),
    maxServicesPerWorkspace: capped(tier.limits.servicesPerWorkspace, UNLIMITED_CAP),
    maxUsersPerWorkspace: capped(tier.limits.usersPerWorkspace, UNLIMITED_CAP),
    includedWorkspaces: tier.limits.includedWorkspaces,
    unlimited: tier.limits.executionsPerMonth === 'unlimited',
    brainTokensQuota: capped(tier.limits.aiTokensPerMonth, UNLIMITED_TOKENS_CAP),
    brainTokensUnlimited: tier.limits.aiTokensPerMonth === 'unlimited',
  };
}

const TIERS = Object.fromEntries(
  PLAN_CATALOG.map((tier) => [tier.id.toUpperCase(), tier]),
) as Record<Plan, PlanTier>;

const LIMITS = Object.fromEntries(
  PLAN_CATALOG.map((tier) => [tier.id.toUpperCase(), deriveLimits(tier)]),
) as Record<Plan, PlanLimits>;

export function planLimits(plan: Plan): PlanLimits {
  return LIMITS[plan];
}

/**
 * Computed price in cents: monthly, or the per-month equivalent when billed annually (10 charged
 * months → 2 free, rounded). Workspace-count-aware: Scale charges its add-on per active workspace
 * beyond the included ones.
 */
export function priceCents(plan: Plan, cycle: BillingCycle, activeWorkspaces = 1): number {
  const tier = TIERS[plan];
  const perExtra = tier.perExtraWorkspaceCents ?? 0;
  const extraWorkspaces = perExtra > 0 ? Math.max(0, activeWorkspaces - tier.limits.includedWorkspaces) : 0;
  const monthly = tier.monthlyCents + extraWorkspaces * perExtra;
  return cycle === 'ANNUAL' ? Math.round((monthly * ANNUAL_MONTHS_CHARGED) / 12) : monthly;
}
