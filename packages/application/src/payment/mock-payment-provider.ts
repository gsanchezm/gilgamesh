import { priceCents } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { CheckoutRequest, PaymentProvider } from '../ports/payment';
import type { InvoiceRecord } from '../ports/records';
import type { InvoiceRepository, SubscriptionRepository } from '../ports/repositories';
import { type ApplyPaymentEvent, INVOICE_WEBHOOK_EFFECTS } from './apply-payment-event';

/** The deterministic signature seam (S13): the only value the mock's `handleWebhook` accepts. */
export const MOCK_WEBHOOK_SIGNATURE = 'mock-signature';

export interface MockPaymentDeps {
  /** When wired, confirm/webhooks persist Invoice rows so the UI has data offline (S13-C). */
  events?: ApplyPaymentEvent;
  invoices?: InvoiceRepository;
  subscriptions?: SubscriptionRepository;
}

/**
 * Offline, deterministic {@link PaymentProvider} stub (slice 4; extended by slice 13). No Stripe,
 * no network, no `Date.now`/`Math.random` — identical inputs yield identical results (time and ids
 * flow from the injected ApplyPaymentEvent's Clock/IdGenerator). The real Stripe adapter replaces
 * this behind the same port via `paymentsFromEnv` (owner decision S13-B).
 */
export class MockPaymentProvider implements PaymentProvider {
  constructor(private readonly deps: MockPaymentDeps = {}) {}

  async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    return { checkoutUrl: `https://mock.pay/checkout/${req.orgId}` };
  }

  async confirmCheckout(orgId: string): Promise<{ providerCustomerId: string; providerSubscriptionId: string }> {
    // The offline stand-in for Stripe's invoice.paid webhook (AC-PAY-02): record ONE deterministic
    // PAID invoice at the domain-computed subscription price. The upsert key in_mock_<orgId> keeps
    // re-confirmation idempotent.
    const sub = await this.deps.subscriptions?.findByOrg(orgId);
    if (this.deps.events && sub) {
      const providerInvoiceId = `in_mock_${orgId}`;
      await this.deps.events.invoiceEvent({
        orgId,
        providerInvoiceId,
        status: 'PAID',
        amountCents: priceCents(sub.plan, sub.billingCycle, sub.seats),
        hostedInvoiceUrl: `https://mock.pay/invoice/${providerInvoiceId}`,
      });
    }
    return { providerCustomerId: `cus_mock_${orgId}`, providerSubscriptionId: `sub_mock_${orgId}` };
  }

  async listInvoices(orgId: string): Promise<InvoiceRecord[]> {
    // S13-C: the local Invoice store is the read model for both providers.
    return (await this.deps.invoices?.listForOrg(orgId)) ?? [];
  }

  async handleWebhook(sig: string, body: Buffer): Promise<void> {
    if (sig !== MOCK_WEBHOOK_SIGNATURE) {
      throw new ApplicationError('FORBIDDEN', 'Invalid webhook signature.');
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ApplicationError('VALIDATION', 'Malformed webhook payload.');
    }
    const effect = INVOICE_WEBHOOK_EFFECTS[String(event.type)];
    if (!effect) return; // unhandled event types are acknowledged, never an error (spec 13 §3)

    const { orgId, providerInvoiceId, amountCents } = event;
    if (
      typeof orgId !== 'string' ||
      orgId.length === 0 ||
      typeof providerInvoiceId !== 'string' ||
      providerInvoiceId.length === 0 ||
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents)
    ) {
      throw new ApplicationError('VALIDATION', 'The webhook payload is missing required invoice fields.');
    }
    await this.deps.events?.invoiceEvent({
      orgId,
      providerInvoiceId,
      status: effect.status,
      amountCents,
      currency: typeof event.currency === 'string' ? event.currency : undefined,
      hostedInvoiceUrl: typeof event.hostedInvoiceUrl === 'string' ? event.hostedInvoiceUrl : null,
      pdfUrl: typeof event.pdfUrl === 'string' ? event.pdfUrl : null,
      subscriptionStatus: effect.subscriptionStatus,
    });
  }
}
