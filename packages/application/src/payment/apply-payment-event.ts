import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { InvoiceStatus, SubscriptionStatus } from '../ports/records';
import type { UnitOfWork } from '../ports/unit-of-work';

/** One provider webhook effect: the keystone Invoice lifecycle + optional Subscription side-effect. */
export interface InvoiceWebhookEffect {
  status: InvoiceStatus;
  subscriptionStatus?: SubscriptionStatus;
}

/**
 * Spec 13 §3: provider event type → keystone lifecycle. SHARED by the mock and the Stripe adapter
 * so both providers translate webhooks identically; anything not listed here is acknowledged and
 * ignored (Stripe emits many event types we don't consume).
 */
export const INVOICE_WEBHOOK_EFFECTS: Readonly<Record<string, InvoiceWebhookEffect>> = {
  'invoice.finalized': { status: 'OPEN' },
  'invoice.paid': { status: 'PAID', subscriptionStatus: 'ACTIVE' },
  'invoice.payment_failed': { status: 'OPEN', subscriptionStatus: 'PAST_DUE' },
  'invoice.voided': { status: 'VOID' },
  'invoice.marked_uncollectible': { status: 'UNCOLLECTIBLE' },
};

export interface InvoiceEventInput {
  orgId: string;
  providerInvoiceId: string;
  status: InvoiceStatus;
  amountCents: number;
  /** Lowercase ISO-4217; defaults to `usd` (keystone §2). */
  currency?: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  hostedInvoiceUrl?: string | null;
  pdfUrl?: string | null;
  /** `invoice.paid` → ACTIVE, `invoice.payment_failed` → PAST_DUE (spec 13 §3). */
  subscriptionStatus?: SubscriptionStatus;
}

export interface CheckoutCompletedInput {
  orgId: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
}

/**
 * The provider-agnostic webhook persistence seam (slice 13): adapters verify + translate provider
 * events, THIS service persists them. Each event commits atomically (UnitOfWork): the invoice
 * upsert and the subscription status side-effect land together or not at all (AC-PAY-04).
 */
export class ApplyPaymentEvent {
  constructor(private readonly deps: { uow: UnitOfWork; ids: IdGenerator; clock: Clock }) {}

  async invoiceEvent(input: InvoiceEventInput): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.uow.transaction(async (repos) => {
      await repos.invoices.upsertByProviderInvoiceId({
        id: this.deps.ids.next(),
        orgId: input.orgId,
        providerInvoiceId: input.providerInvoiceId,
        status: input.status,
        amountCents: input.amountCents,
        currency: input.currency ?? 'usd',
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
        pdfUrl: input.pdfUrl ?? null,
        createdAt: now,
        updatedAt: now,
      });
      if (input.subscriptionStatus) {
        const sub = await repos.subscriptions.findByOrg(input.orgId);
        if (sub) await repos.subscriptions.save({ ...sub, status: input.subscriptionStatus });
      }
    });
  }

  /**
   * Stripe `checkout.session.completed` — with a real provider THIS is the authoritative
   * activation (owner decision S13-D); the UI confirm button then merely echoes the stored ids.
   */
  async checkoutCompleted(input: CheckoutCompletedInput): Promise<void> {
    await this.deps.uow.transaction(async (repos) => {
      const sub = await repos.subscriptions.findByOrg(input.orgId);
      if (!sub) return;
      await repos.subscriptions.save({
        ...sub,
        status: 'ACTIVE',
        providerCustomerId: input.providerCustomerId ?? sub.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId ?? sub.providerSubscriptionId,
      });
    });
  }
}
