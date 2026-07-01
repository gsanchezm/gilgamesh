/**
 * Public marketing plan catalog — the owner's 2026-07-01 business model: four self-serve tiers billed
 * PER ACTIVE WORKSPACE / month (Free / Starter / Growth / Scale). Pure, framework-agnostic (Clean
 * Architecture — no imports), so web + a future mobile app render the same source of truth.
 *
 * NOTE: this is the *marketing* catalog. The billing/subscription domain (`../billing/plans.ts`) still
 * models the legacy TEAM/PRO/ENTERPRISE per-seat tiers; migrating that backend + the /billing screen to
 * this model is its own follow-up slice. Keep the two clearly separate until then.
 */

export type PlanTierId = 'free' | 'starter' | 'growth' | 'scale';
export type PricingCycle = 'monthly' | 'annual';

export interface PlanTier {
  id: PlanTierId;
  name: string;
  tagline: string;
  /** Monthly price in cents. 0 for Free; for Scale this is the base (10 workspaces included). */
  monthlyCents: number;
  /** Per additional workspace / month, in cents. Scale only (undefined elsewhere). */
  perExtraWorkspaceCents?: number;
  /** The single "Most popular" highlight. */
  highlight: boolean;
  ctaLabel: string;
  /** Preface above the feature list ("Everything in Free, plus"); null for the entry tier. */
  inheritsFromName: string | null;
  features: readonly string[];
}

/** Annual billing charges 10 months → 2 months free. */
export const ANNUAL_MONTHS_FREE = 2;
const ANNUAL_MONTHS_CHARGED = 12 - ANNUAL_MONTHS_FREE;

export const PLAN_CATALOG: readonly PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For individuals, open source and students.',
    monthlyCents: 0,
    highlight: false,
    ctaLabel: 'Get started',
    inheritsFromName: null,
    features: [
      '1 workspace',
      '2 services (repos) per workspace',
      '500 executions / month',
      'Natural language → tests (20 / month)',
      'GitHub Actions',
      'Basic dashboard',
      '7-day history',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'For freelancers and early-stage startups.',
    monthlyCents: 2900,
    highlight: false,
    ctaLabel: 'Start free →',
    inheritsFromName: 'Everything in Free, plus',
    features: [
      'Unlimited workspaces',
      '5 services per workspace',
      '5,000 executions / mo per workspace',
      'Unlimited natural-language generation',
      'BDD + import .feature files',
      'Flakiness detection',
      'GitHub Actions · ADO Pipelines · GitLab CI',
      'Slack + Teams notifications',
      '3 users per workspace',
      '30-day history',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'For scaling teams of 5–30 people.',
    monthlyCents: 9900,
    highlight: true,
    ctaLabel: 'Start free →',
    inheritsFromName: 'Everything in Starter, plus',
    features: [
      '15 services per workspace',
      '25,000 executions / month',
      'Unlimited users per workspace',
      'Advanced confidence index per vertical slice',
      'TestRail · Xray · Azure Test Plans',
      'Jenkins · CircleCI · Bitbucket Pipelines',
      'Basic visual testing · auto API contracts',
      'Exportable PDF reports',
      '90-day history',
      'Email support · 48h SLA',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    tagline: 'For enterprises, agencies and 30+ teams.',
    monthlyCents: 49900,
    perExtraWorkspaceCents: 9900,
    highlight: false,
    ctaLabel: 'Start free →',
    inheritsFromName: 'Everything in Growth, plus',
    features: [
      '10 workspaces included, then $99 each',
      'Unlimited executions',
      'Unlimited services per workspace',
      'SSO / SAML',
      'Granular roles & permissions',
      '99.9% uptime SLA · audit logs',
      '24h priority support · dedicated onboarding',
      'Jira + ServiceNow',
      'Unlimited history',
      'On-premise deploy (roadmap)',
    ],
  },
];

const BY_ID: Record<PlanTierId, PlanTier> = Object.fromEntries(
  PLAN_CATALOG.map((t) => [t.id, t]),
) as Record<PlanTierId, PlanTier>;

export function planTier(id: PlanTierId): PlanTier {
  return BY_ID[id];
}

/** Total charged per year when billed annually (10 months). Free stays 0. */
export function annualTotalCents(tier: PlanTier): number {
  return tier.monthlyCents * ANNUAL_MONTHS_CHARGED;
}

/**
 * Price to DISPLAY in cents for a cycle. Monthly = the monthly price; annual = the per-month
 * equivalent when billed annually (annual total / 12), rounded — so the two cycles are comparable
 * on the card (matches the prototype: $499/mo → $416/mo billed annually). Free is always 0.
 */
export function displayPriceCents(tier: PlanTier, cycle: PricingCycle): number {
  if (cycle === 'monthly' || tier.monthlyCents === 0) return tier.monthlyCents;
  return Math.round(annualTotalCents(tier) / 12);
}
