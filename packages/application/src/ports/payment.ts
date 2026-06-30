import type { BillingCycle, Plan } from './records';

/**
 * The billing seam (keystone §5 `PaymentProvider`): "MOCK now; Stripe later — no UI/domain change."
 * Slice 4 wires a deterministic {@link MockPaymentProvider} (offline, no Stripe/network). The real
 * Stripe adapter (and the deferred `getSubscription`/`updateSeats`/`listInvoices`/`handleWebhook`) is a
 * later billing slice; `confirmCheckout` stands in for the Stripe webhook the mock doesn't receive.
 */
export interface CheckoutRequest {
  orgId: string;
  plan: Plan;
  cycle: BillingCycle;
  seats: number;
}

export interface PaymentProvider {
  createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Mock stand-in for the provider's success webhook: mints the customer/subscription ids. */
  confirmCheckout(orgId: string): Promise<{ providerCustomerId: string; providerSubscriptionId: string }>;
}
