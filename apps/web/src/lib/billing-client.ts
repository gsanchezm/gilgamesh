import { getJson, sendJson } from './http';

export type Plan = 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface SubscriptionView {
  plan: Plan;
  status: string;
  billingCycle: BillingCycle;
  seats: number;
  maxSeats: number;
  maxServicesPerWorkspace: number;
  maxUsersPerWorkspace: number;
  includedWorkspaces: number;
  unlimited: boolean;
  runMinutesQuota: number;
  runMinutesUsed: number;
  priceCents: number;
  providerCustomerId: string | null;
  currentPeriodEnd: string | null;
}

/** Keystone §1 v0.5 — mirrors the provider's (Stripe) invoice lifecycle. */
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

/** Keystone §6 v0.5 — `GET /orgs/{orgId}/invoices` (newest-first). */
export interface InvoiceView {
  id: string;
  providerInvoiceId: string | null;
  status: InvoiceStatus;
  amountCents: number;
  /** Lowercase ISO-4217 (e.g. `usd`). */
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

export type BrainTier = 'HAIKU' | 'SONNET' | 'OPUS';
export type BrainSurface = 'CHAT' | 'ROUTER' | 'GENERATE' | 'EMBED';

export interface BrainUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/** Keystone v0.3 B1 — `GET /orgs/{orgId}/brain/usage` (per-tier/per-surface aggregate). */
export interface BrainUsageView {
  totals: BrainUsageTotals;
  byTier: ({ tier: BrainTier } & BrainUsageTotals)[];
  bySurface: ({ surface: BrainSurface } & BrainUsageTotals)[];
}

export interface BillingClient {
  getSubscription(orgId: string): Promise<SubscriptionView>;
  changePlan(orgId: string, input: { plan: Plan; billingCycle?: BillingCycle }): Promise<SubscriptionView>;
  updateSeats(orgId: string, seats: number): Promise<SubscriptionView>;
  checkout(orgId: string): Promise<{ checkoutUrl: string }>;
  confirmCheckout(orgId: string): Promise<SubscriptionView>;
  cancel(orgId: string): Promise<SubscriptionView>;
  getBrainUsage(orgId: string): Promise<BrainUsageView>;
  listInvoices(orgId: string): Promise<InvoiceView[]>;
}

const base = (orgId: string) => `/orgs/${orgId}/subscription`;

export const httpBillingClient: BillingClient = {
  getSubscription: (orgId) => getJson(base(orgId), 'Could not load the subscription.'),
  changePlan: (orgId, input) => sendJson('PATCH', base(orgId), input, 'Could not change the plan.'),
  updateSeats: (orgId, seats) => sendJson('PATCH', `${base(orgId)}/seats`, { seats }, 'Could not update seats.'),
  checkout: (orgId) => sendJson('POST', `${base(orgId)}/checkout`, {}, 'Could not start checkout.'),
  confirmCheckout: (orgId) => sendJson('POST', `${base(orgId)}/checkout/confirm`, {}, 'Could not confirm checkout.'),
  cancel: (orgId) => sendJson('POST', `${base(orgId)}/cancel`, {}, 'Could not cancel the subscription.'),
  getBrainUsage: (orgId) => getJson(`/orgs/${orgId}/brain/usage`, 'Could not load the AI usage.'),
  listInvoices: (orgId) => getJson(`/orgs/${orgId}/invoices`, 'Could not load the invoices.'),
};
