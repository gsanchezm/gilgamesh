import type { CheckoutRequest, PaymentProvider } from '../ports/payment';

/**
 * Offline, deterministic {@link PaymentProvider} stub for slice 4 (the Brain/Kernel-stub pattern). No
 * Stripe, no network, no `Date.now`/`Math.random` — identical inputs yield identical results, so checkout
 * is reproducible and testable. The real Stripe adapter replaces this behind the same port.
 */
export class MockPaymentProvider implements PaymentProvider {
  async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://mock.pay/checkout/${req.orgId}` };
  }

  async confirmCheckout(orgId: string): Promise<{ providerCustomerId: string; providerSubscriptionId: string }> {
    return { providerCustomerId: `cus_mock_${orgId}`, providerSubscriptionId: `sub_mock_${orgId}` };
  }
}
