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
}
