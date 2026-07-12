import { priceCents, prorationAmountCents, quoteRefund, remainingPeriodFraction } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type {
  ChangePlanRequest,
  CheckoutRequest,
  PaymentProvider,
  PreviewRefundRequest,
  RefundPreview,
  RefundRequest,
} from '../ports/payment';
import type { InvoiceRecord, SubscriptionRecord } from '../ports/records';
import type { InvoiceRepository, SubscriptionRepository } from '../ports/repositories';
import { type ApplyPaymentEvent, INVOICE_WEBHOOK_EFFECTS } from './apply-payment-event';

/** The deterministic signature seam (S13): the only value the mock's `handleWebhook` accepts. */
export const MOCK_WEBHOOK_SIGNATURE = 'mock-signature';

export interface MockPaymentDeps {
  /** When wired, confirm/webhooks persist Invoice rows so the UI has data offline (S13-C). */
  events?: ApplyPaymentEvent;
  invoices?: InvoiceRepository;
  subscriptions?: SubscriptionRepository;
  /** Slice 40: the injected clock for deterministic proration (no `Date.now`). */
  clock?: Clock;
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

  async createPortalSession(orgId: string): Promise<{ portalUrl: string }> {
    // S34: deterministic, offline — no Stripe, no network. Same shape the Stripe adapter returns.
    return { portalUrl: `https://mock.pay/portal/${orgId}` };
  }

  /**
   * S40: the signed proration a plan change WOULD apply — `round((newPrice − oldPrice) × remaining
   * fraction)`, both prices from the domain catalog, the fraction from the injected clock + the
   * (pre-change) subscription's `currentPeriodEnd`. Deterministic; `null`/no clock → 0. The use case
   * calls this BEFORE saving the new plan, so the `sub` read here is the still-current row.
   */
  private async computeProration(req: ChangePlanRequest): Promise<number> {
    const sub = await this.deps.subscriptions?.findByOrg(req.orgId);
    if (!sub || !this.deps.clock) return 0;
    const fraction = remainingPeriodFraction(sub.currentPeriodEnd, sub.billingCycle, this.deps.clock.now());
    const oldPrice = priceCents(sub.plan, sub.billingCycle, sub.seats);
    const newPrice = priceCents(req.plan, req.cycle, req.seats);
    return prorationAmountCents(oldPrice, newPrice, fraction);
  }

  async previewProration(req: ChangePlanRequest): Promise<{ prorationCents: number }> {
    // AC-PRORATE-04: read-only — computes the SAME amount as changePlan, mutates nothing.
    return { prorationCents: await this.computeProration(req) };
  }

  async changePlan(req: ChangePlanRequest): Promise<{ prorationCents: number }> {
    const prorationCents = await this.computeProration(req);
    // Record the proration as an OPEN invoice so it shows in the Invoices panel (owner decision B-1:
    // it rides to the next invoice). Signed amount; skip a no-op 0. Deterministic upsert key.
    if (prorationCents !== 0 && this.deps.events) {
      const providerInvoiceId = `in_mock_prorate_${req.orgId}`;
      await this.deps.events.invoiceEvent({
        orgId: req.orgId,
        providerInvoiceId,
        status: 'OPEN',
        amountCents: prorationCents,
        hostedInvoiceUrl: `https://mock.pay/invoice/${providerInvoiceId}`,
      });
    }
    return { prorationCents };
  }

  async refund(req: RefundRequest): Promise<{ refundedCents: number }> {
    // S40 cancellation path (no explicit amount): a prorated refund of the UNUSED portion. UNCHANGED.
    if (req.amountCents === undefined) return this.refundCancellation(req.orgId);
    // S41 partial (amount-level) refund: ceiling = the target paid invoice's amount; refund exactly
    // the requested amount (an over-ceiling request is rejected). Recorded as a credit VOID invoice.
    const { amountCents, exceedsCeiling } = quoteRefund(req.amountCents, await this.refundableCeiling(req.orgId, req.invoiceId));
    if (exceedsCeiling) {
      throw new ApplicationError('VALIDATION', 'The refund exceeds the invoice refundable amount.');
    }
    if (amountCents <= 0 || !this.deps.events || !this.deps.invoices) return { refundedCents: amountCents };
    // A distinct upsert key per partial refund (count of existing partial-refund rows) so successive
    // partial refunds do not overwrite one another.
    const existing = (await this.deps.invoices.listForOrg(req.orgId)).filter((i) =>
      i.providerInvoiceId?.startsWith(`in_mock_refund_partial_${req.orgId}`),
    ).length;
    const providerInvoiceId = `in_mock_refund_partial_${req.orgId}_${existing}`;
    await this.deps.events.invoiceEvent({
      orgId: req.orgId,
      providerInvoiceId,
      status: 'VOID',
      amountCents: -amountCents,
      hostedInvoiceUrl: `https://mock.pay/invoice/${providerInvoiceId}`,
    });
    return { refundedCents: amountCents };
  }

  async previewRefund(req: PreviewRefundRequest): Promise<RefundPreview> {
    // S41: read-only — the same quote refund() applies, mutating nothing.
    const { refundableCents, amountCents } = quoteRefund(req.amountCents, await this.refundableCeiling(req.orgId, req.invoiceId));
    return { refundableCents, amountCents };
  }

  /** S41: the partial-refund ceiling = the (targeted, else latest) PAID invoice's amount; 0 when none. */
  private async refundableCeiling(orgId: string, invoiceId?: string): Promise<number> {
    const paid = ((await this.deps.invoices?.listForOrg(orgId)) ?? []).filter((i) => i.status === 'PAID');
    const target = invoiceId ? paid.find((i) => i.id === invoiceId || i.providerInvoiceId === invoiceId) : paid[0];
    return target?.amountCents ?? 0;
  }

  /** S40 (owner decision B-2): the prorated unused-portion refund on cancellation — a paid-invoice-only,
   *  deterministic credit VOID invoice. Refactored verbatim from the pre-slice-41 `refund`. */
  private async refundCancellation(orgId: string): Promise<{ refundedCents: number }> {
    const sub = await this.deps.subscriptions?.findByOrg(orgId);
    const invoices = (await this.deps.invoices?.listForOrg(orgId)) ?? [];
    const hasPaidInvoice = invoices.some((i: InvoiceRecord) => i.status === 'PAID');
    if (!sub || !this.deps.clock || !hasPaidInvoice) return { refundedCents: 0 };
    const refundedCents = this.unusedCredit(sub);
    if (refundedCents > 0 && this.deps.events) {
      const providerInvoiceId = `in_mock_refund_${orgId}`;
      await this.deps.events.invoiceEvent({
        orgId,
        providerInvoiceId,
        status: 'VOID',
        amountCents: -refundedCents,
        hostedInvoiceUrl: `https://mock.pay/invoice/${providerInvoiceId}`,
      });
    }
    return { refundedCents };
  }

  /** The unused-portion credit: `round(currentPrice × remainingFraction)`. */
  private unusedCredit(sub: SubscriptionRecord): number {
    const fraction = remainingPeriodFraction(sub.currentPeriodEnd, sub.billingCycle, this.deps.clock!.now());
    return prorationAmountCents(0, priceCents(sub.plan, sub.billingCycle, sub.seats), fraction);
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
