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
  /** Monthly AI Brain token allowance (slice 14, keystone v0.6). */
  brainTokensQuota: number;
  brainTokensUsed: number;
  /** True on SCALE — token blocking is bypassed (metering isn't). */
  brainTokensUnlimited: boolean;
  priceCents: number;
  providerCustomerId: string | null;
  currentPeriodEnd: string | null;
  /** Slice 40: the signed proration a plan change applied (+charge / −credit); absent on reads. */
  prorationCents?: number;
  /** Slice 40: the amount refunded by an opt-in cancel-with-refund. */
  refundedCents?: number;
}

/** Slice 40: the read-only proration estimate shown before a plan change is confirmed. */
export interface PlanChangePreview {
  plan: Plan;
  billingCycle: BillingCycle;
  /** Signed: positive = charged now, negative = credited. 0 when there is no billing account. */
  prorationCents: number;
}

/** Slice 41: create_prorations (default) | always_invoice (issue the proration invoice immediately). */
export type ProrationBehavior = 'create_prorations' | 'always_invoice';

/** Slice 41: the read-only refund estimate shown before a partial refund is confirmed. */
export interface RefundPreview {
  /** The invoice's refundable ceiling in cents (0 when nothing is refundable). */
  refundableCents: number;
  /** The amount that would be refunded — the request clamped to the ceiling (previewed == charged). */
  amountCents: number;
}

/** Slice 41: the outcome of an executed partial refund. */
export interface RefundResult {
  refundedCents: number;
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
  changePlan(
    orgId: string,
    input: { plan: Plan; billingCycle?: BillingCycle; prorationBehavior?: ProrationBehavior },
  ): Promise<SubscriptionView>;
  /** Slice 40: a read-only proration estimate for a prospective plan change (no mutation). */
  previewProration(orgId: string, input: { plan: Plan; billingCycle?: BillingCycle }): Promise<PlanChangePreview>;
  updateSeats(orgId: string, seats: number): Promise<SubscriptionView>;
  checkout(orgId: string): Promise<{ checkoutUrl: string }>;
  confirmCheckout(orgId: string): Promise<SubscriptionView>;
  /** Slice 40: cancel gains an opt-in prorated refund of the unused period (defaults to no refund). */
  cancel(orgId: string, opts?: { refund?: boolean }): Promise<SubscriptionView>;
  /** Slice 41: a read-only estimate of a partial refund (ceiling + clamped amount; no charge). */
  previewRefund(orgId: string, input: { amountCents?: number; invoiceId?: string }): Promise<RefundPreview>;
  /** Slice 41: a partial (amount-level) refund of a paid invoice. */
  refund(orgId: string, input: { amountCents: number; invoiceId?: string }): Promise<RefundResult>;
  /** Slice 34: mint a Stripe hosted billing-portal link; the caller navigates the browser to it. */
  openPortal(orgId: string): Promise<{ portalUrl: string }>;
  getBrainUsage(orgId: string): Promise<BrainUsageView>;
  listInvoices(orgId: string): Promise<InvoiceView[]>;
}

const base = (orgId: string) => `/orgs/${orgId}/subscription`;

export const httpBillingClient: BillingClient = {
  getSubscription: (orgId) => getJson(base(orgId), 'Could not load the subscription.'),
  changePlan: (orgId, input) => sendJson('PATCH', base(orgId), input, 'Could not change the plan.'),
  previewProration: (orgId, input) =>
    sendJson('POST', `${base(orgId)}/preview`, input, 'Could not preview the plan change.'),
  updateSeats: (orgId, seats) => sendJson('PATCH', `${base(orgId)}/seats`, { seats }, 'Could not update seats.'),
  checkout: (orgId) => sendJson('POST', `${base(orgId)}/checkout`, {}, 'Could not start checkout.'),
  confirmCheckout: (orgId) => sendJson('POST', `${base(orgId)}/checkout/confirm`, {}, 'Could not confirm checkout.'),
  cancel: (orgId, opts) =>
    sendJson('POST', `${base(orgId)}/cancel`, { refund: opts?.refund ?? false }, 'Could not cancel the subscription.'),
  previewRefund: (orgId, input) =>
    sendJson('POST', `${base(orgId)}/refund/preview`, input, 'Could not preview the refund.'),
  refund: (orgId, input) => sendJson('POST', `${base(orgId)}/refund`, input, 'Could not process the refund.'),
  openPortal: (orgId) => sendJson('POST', `/orgs/${orgId}/billing/portal`, {}, 'Could not open the billing portal.'),
  getBrainUsage: (orgId) => getJson(`/orgs/${orgId}/brain/usage`, 'Could not load the AI usage.'),
  listInvoices: (orgId) => getJson(`/orgs/${orgId}/invoices`, 'Could not load the invoices.'),
};
