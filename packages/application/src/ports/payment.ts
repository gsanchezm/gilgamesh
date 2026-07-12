import type { BillingCycle, InvoiceRecord, Plan } from './records';

/**
 * The billing seam (keystone §5 `PaymentProvider`): "MOCK now; Stripe later — no UI/domain change."
 * Slice 4 wired a deterministic {@link MockPaymentProvider} (offline, no Stripe/network); slice 13
 * grows the implemented subset toward the keystone signature with `listInvoices` + `handleWebhook`
 * and adds the real Stripe adapter behind `paymentsFromEnv` (owner decision S13-B, the slice-9
 * brain pattern). Slice 34 adds `createPortalSession` the SAME additive way (owner decision S34-A —
 * NO keystone amendment, exactly like `listInvoices`/`handleWebhook`). The still-deferred keystone
 * methods are `getSubscription`/`updateSeats`; `confirmCheckout` remains the mock's stand-in for the
 * provider's success webhook.
 */
export interface CheckoutRequest {
  orgId: string;
  plan: Plan;
  cycle: BillingCycle;
  /** Active workspaces. Kept as `seats` for the provider seam until Stripe is introduced. */
  seats: number;
}

/**
 * Slice 41: how a plan-change proration is invoiced. `create_prorations` (the slice-40 default) rides
 * the delta to the next invoice; `always_invoice` issues the proration immediately, mid-cycle.
 */
export type ProrationBehavior = 'create_prorations' | 'always_invoice';

/**
 * The target of a plan change (slice 40). Carries ONLY the desired plan/cycle/seats — the provider
 * resolves the org's current (pre-change) subscription itself to compute the signed proration.
 */
export interface ChangePlanRequest {
  orgId: string;
  plan: Plan;
  cycle: BillingCycle;
  /** Active workspaces (same seam name as CheckoutRequest). */
  seats: number;
  /**
   * Slice 41 (additive): when to invoice the proration. Absent → `create_prorations` (the slice-40
   * behavior; the provider applies its default). Callers that omit it are byte-for-byte unchanged.
   */
  prorationBehavior?: ProrationBehavior;
}

/**
 * Slice 41: a refund request. TWO paths behind the one method (backward-compatible):
 *  - **`amountCents` absent** → the slice-40 CANCELLATION refund (prorated unused portion). This is
 *    what {@link PaymentProvider.refund} did before slice 41; `CancelSubscription` still calls it.
 *  - **`amountCents` present** → a PARTIAL (amount-level) refund of exactly that amount, capped by the
 *    target paid invoice's ceiling (an over-ceiling request throws VALIDATION).
 */
export interface RefundRequest {
  orgId: string;
  /** Absent → cancellation (prorated unused portion). Present → a partial refund of this many cents. */
  amountCents?: number;
  reason?: 'cancellation' | 'manual';
  /** Slice 41: target a specific paid invoice; defaults to the latest paid invoice. */
  invoiceId?: string;
}

/** Slice 41: the read-only refund estimate — the invoice ceiling + the (clamped) amount to refund. */
export interface RefundPreview {
  /** The (target) invoice's refundable ceiling in cents; 0 when nothing is refundable. */
  refundableCents: number;
  /** The amount that would be refunded — the request clamped to the ceiling (previewed == charged). */
  amountCents: number;
}

/** Slice 41: the read-only refund preview request (a partial-refund amount, or absent for the max). */
export interface PreviewRefundRequest {
  orgId: string;
  amountCents?: number;
  invoiceId?: string;
}

export interface PaymentProvider {
  createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Mock stand-in for the provider's success webhook: mints the customer/subscription ids. */
  confirmCheckout(orgId: string): Promise<{ providerCustomerId: string; providerSubscriptionId: string }>;
  /** The org's invoices (keystone §5). Both adapters read the LOCAL webhook-fed store (S13-C). */
  listInvoices(orgId: string): Promise<InvoiceRecord[]>;
  /**
   * Verifies `sig` against the RAW request bytes (never a re-serialized parse) and applies the
   * provider event per the spec-13 §3 mapping. An invalid signature throws FORBIDDEN and must
   * persist nothing; unhandled event types are acknowledged silently.
   */
  handleWebhook(sig: string, body: Buffer): Promise<void>;
  /**
   * Slice 34 (additive, portal-only): mint a one-time hosted billing-portal link for the org's
   * provider customer (plan change / proration / payment method / cancel are all Stripe's hosted UI).
   * The mock returns a deterministic offline URL; the Stripe adapter resolves the org's
   * `providerCustomerId` and calls `billingPortal.sessions.create`. The caller (use case) gates
   * OWNER/ADMIN and rejects an org with no billing account BEFORE this is reached.
   */
  createPortalSession(orgId: string): Promise<{ portalUrl: string }>;
  /**
   * Slice 40 (additive, programmatic proration): apply a plan change to the provider subscription,
   * prorated over the remaining period (`create_prorations` — the delta rides to the next invoice,
   * owner decision B-1). Returns the SIGNED proration in cents (positive = charge / negative =
   * credit). The mock records it as an OPEN Invoice; a real Stripe change schedules it on the next
   * invoice. Called by the use case only when the subscription already has a `providerSubscriptionId`.
   */
  changePlan(req: ChangePlanRequest): Promise<{ prorationCents: number }>;
  /**
   * Slice 40: the read-only estimate of the SAME signed amount {@link changePlan} would apply, with
   * NO mutation (no invoice row, no provider write) — so the UI can show "+$X now / −$Y credit"
   * before the user confirms (AC-PRORATE-04).
   */
  previewProration(req: ChangePlanRequest): Promise<{ prorationCents: number }>;
  /**
   * Refund against the org's latest (or a targeted) paid invoice. Returns the positive refunded amount
   * in cents (0 when there is nothing to refund).
   *  - Slice 40 (owner decision B-2), `amountCents` absent → the prorated UNUSED portion of the current
   *    period (cancellation). The mock records a credit Invoice (negative `amountCents`, VOID); a real
   *    Stripe refund hits the latest paid invoice's payment intent.
   *  - Slice 41, `amountCents` present → a PARTIAL refund of exactly that amount, capped by the invoice
   *    ceiling. A request beyond the ceiling throws `VALIDATION` (never a silent clamp / 500).
   */
  refund(req: RefundRequest): Promise<{ refundedCents: number }>;
  /**
   * Slice 41: the read-only estimate of a partial refund — the invoice's refundable ceiling and the
   * (clamped) amount that would be refunded — with NO charge and NO invoice row. Shares the pure
   * {@link quoteRefund} source with {@link refund}, so a previewed amount equals the charged amount for
   * any valid (≤ ceiling) request.
   */
  previewRefund(req: PreviewRefundRequest): Promise<RefundPreview>;
}
