import {
  ApplicationError,
  type ApplyPaymentEvent,
  type ChangePlanRequest,
  type CheckoutRequest,
  type Clock,
  INVOICE_WEBHOOK_EFFECTS,
  type InvoiceRecord,
  type InvoiceRepository,
  MockPaymentProvider,
  type PaymentProvider,
  type SubscriptionRepository,
} from '@gilgamesh/application';
import { ANNUAL_MONTHS_CHARGED, priceCents, prorationAmountCents, remainingPeriodFraction } from '@gilgamesh/domain';
import Stripe from 'stripe';

/**
 * Provider selection (slice 13, owner decision S13-B — the slice-9 `resolveBrainMode` pattern):
 * `PAYMENTS_MODE=offline` OR no `STRIPE_SECRET_KEY` → the deterministic mock always answers
 * (the harness/CI default — no suite ever calls stripe.com). Otherwise mode `auto` delegates to
 * {@link StripePaymentProvider} with the platform key.
 */
export type PaymentsMode = 'offline' | 'auto';

export function resolvePaymentsMode(env: NodeJS.ProcessEnv = process.env): PaymentsMode {
  return env.PAYMENTS_MODE === 'offline' || !env.STRIPE_SECRET_KEY?.trim() ? 'offline' : 'auto';
}

export interface StripeProviderOptions {
  secretKey: string;
  /** Required to accept webhooks; without it every delivery is refused (never verified blindly). */
  webhookSecret?: string;
  successUrl: string;
  cancelUrl: string;
  /** Where Stripe's hosted billing portal returns the admin (slice 34). Defaults to the success URL. */
  portalReturnUrl: string;
}

export function stripeOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): StripeProviderOptions {
  const successUrl = env.STRIPE_SUCCESS_URL?.trim() || 'http://localhost:5173/billing?checkout=success';
  return {
    secretKey: env.STRIPE_SECRET_KEY?.trim() ?? '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    successUrl,
    cancelUrl: env.STRIPE_CANCEL_URL?.trim() || 'http://localhost:5173/billing?checkout=canceled',
    // S34: the portal return URL falls back to the success URL, then its default — following the
    // existing trim-and-default convention for the redirect URLs.
    portalReturnUrl: env.STRIPE_PORTAL_RETURN_URL?.trim() || successUrl,
  };
}

/** Shared with the mock: the webhook persistence seam + the local Invoice read model (S13-C). */
export interface PaymentProviderDeps {
  events: ApplyPaymentEvent;
  invoices: InvoiceRepository;
  subscriptions: SubscriptionRepository;
  /** Slice 40: the clock driving the deterministic prorated-refund amount. */
  clock: Clock;
}

/** Basil-era invoices carry the subscription metadata under `parent.subscription_details`. */
interface InvoiceSubscriptionMetadata {
  parent?: { subscription_details?: { metadata?: Record<string, string | null> | null } | null } | null;
  subscription_details?: { metadata?: Record<string, string | null> | null } | null;
}

/**
 * Minimal INBOUND read-shape for a preview invoice's proration lines (slice 40). Basil moved the
 * per-line `proration` flag under `parent.{subscription_item_details|invoice_item_details}`; we read
 * either that or a flat legacy `proration`, without depending on Stripe's churny full line type
 * (the `InvoiceSubscriptionMetadata` cast precedent). OUTBOUND params stay natively typed.
 */
interface ProrationPreviewLine {
  amount?: number | null;
  proration?: boolean | null;
  parent?: {
    subscription_item_details?: { proration?: boolean | null } | null;
    invoice_item_details?: { proration?: boolean | null } | null;
  } | null;
}

/** Sum the proration line amounts of a preview invoice (signed: + charge / − credit). */
function sumProrationLines(preview: Stripe.Invoice): number {
  const lines = (preview as unknown as { lines?: { data?: ProrationPreviewLine[] } }).lines?.data ?? [];
  let total = 0;
  for (const line of lines) {
    const isProration =
      line.proration === true ||
      line.parent?.subscription_item_details?.proration === true ||
      line.parent?.invoice_item_details?.proration === true;
    if (isProration) total += line.amount ?? 0;
  }
  return total;
}

const toDate = (unixSeconds: unknown): Date | null =>
  typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;

/**
 * The real {@link PaymentProvider} (slice 13): Stripe Checkout for `createCheckout`, and
 * signature-verified webhooks (`stripe.webhooks.constructEvent` over the RAW body bytes) that
 * persist keystone `Invoice` rows and drive `Subscription.status` via {@link ApplyPaymentEvent}.
 *
 * Secret hygiene (AC-PAY-08): `secretKey`/`webhookSecret` live only inside this adapter and the
 * SDK client — they are NEVER logged, embedded in thrown error messages, or written to any row.
 * Verification failures throw a FIXED string; the SDK's own error text is discarded.
 */
export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: Stripe;

  constructor(
    private readonly opts: StripeProviderOptions,
    private readonly deps: PaymentProviderDeps,
    stripe?: Stripe,
  ) {
    this.stripe = stripe ?? new Stripe(this.opts.secretKey);
  }

  async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string }> {
    // Match the mock semantics: the price comes from the domain PLAN_CATALOG (slice 10, single
    // source). Annual bills 10 charged months (keystone §9) as ONE yearly recurring amount.
    const monthly = priceCents(req.plan, 'MONTHLY', req.seats);
    if (monthly <= 0) {
      throw new ApplicationError('VALIDATION', 'The FREE plan has nothing to check out.');
    }
    const annual = req.cycle === 'ANNUAL';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: req.orgId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: annual ? monthly * ANNUAL_MONTHS_CHARGED : monthly,
            recurring: { interval: annual ? 'year' : 'month' },
            product_data: { name: `Gilgamesh ${req.plan} — ${req.seats} active workspace(s)` },
          },
        },
      ],
      // orgId rides on the session AND the subscription so every derived invoice resolves its
      // tenant without a customer lookup.
      metadata: { orgId: req.orgId },
      subscription_data: { metadata: { orgId: req.orgId } },
      success_url: this.opts.successUrl,
      cancel_url: this.opts.cancelUrl,
    });
    if (!session.url) {
      throw new ApplicationError('VALIDATION', 'Stripe did not return a checkout URL.');
    }
    return { checkoutUrl: session.url };
  }

  async confirmCheckout(orgId: string): Promise<{ providerCustomerId: string; providerSubscriptionId: string }> {
    // S13-D: with real Stripe the WEBHOOK (checkout.session.completed) is the authoritative
    // activation; confirm merely echoes the ids the webhook already stored.
    const sub = await this.deps.subscriptions.findByOrg(orgId);
    if (!sub?.providerCustomerId || !sub.providerSubscriptionId) {
      throw new ApplicationError(
        'VALIDATION',
        'Checkout has not completed yet — Stripe activates the subscription via webhook.',
      );
    }
    return { providerCustomerId: sub.providerCustomerId, providerSubscriptionId: sub.providerSubscriptionId };
  }

  async listInvoices(orgId: string): Promise<InvoiceRecord[]> {
    // S13-C: the local webhook-fed store is the read model — no network call on a page view.
    return this.deps.invoices.listForOrg(orgId);
  }

  async createPortalSession(orgId: string): Promise<{ portalUrl: string }> {
    // S34 (portal-only): resolve the org's Stripe customer and mint a one-time hosted-portal link.
    // The use case already gated OWNER/ADMIN; this defends the precondition again (a null customer
    // → VALIDATION, exactly like confirmCheckout — never a crash, never a bare Stripe error).
    const sub = await this.deps.subscriptions.findByOrg(orgId);
    if (!sub?.providerCustomerId) {
      throw new ApplicationError('VALIDATION', 'No billing account yet — complete a checkout first.');
    }
    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.providerCustomerId,
      return_url: this.opts.portalReturnUrl,
    });
    if (!session.url) {
      throw new ApplicationError('VALIDATION', 'Stripe did not return a portal URL.');
    }
    return { portalUrl: session.url };
  }

  // ---- Slice 40: programmatic proration + refunds ------------------------------------------------

  async previewProration(req: ChangePlanRequest): Promise<{ prorationCents: number }> {
    const item = await this.resolveSubscriptionItem(req.orgId);
    return { prorationCents: await this.previewProrationAmount(item, req) };
  }

  async changePlan(req: ChangePlanRequest): Promise<{ prorationCents: number }> {
    const item = await this.resolveSubscriptionItem(req.orgId);
    // Compute the amount from a preview (no side-effect), THEN apply the change so the delta rides to
    // the next invoice (owner decision B-1: `create_prorations`). Same price_data on both calls.
    const prorationCents = await this.previewProrationAmount(item, req);
    await this.stripe.subscriptions.update(item.subscriptionId, {
      items: [{ id: item.itemId, price_data: this.subscriptionPriceData(req, item.productId) }],
      proration_behavior: 'create_prorations',
    });
    return { prorationCents };
  }

  async refund(req: { orgId: string; reason: 'cancellation' }): Promise<{ refundedCents: number }> {
    // B-2: refund the prorated UNUSED portion of the current period against the latest paid invoice's
    // payment intent. No paid invoice / no time remaining → 0 (nothing to refund).
    const sub = await this.deps.subscriptions.findByOrg(req.orgId);
    const invoices = await this.deps.invoices.listForOrg(req.orgId); // newest-first (S13-C read model)
    const latestPaid = invoices.find((i) => i.status === 'PAID' && i.providerInvoiceId);
    if (!sub || !latestPaid?.providerInvoiceId) return { refundedCents: 0 };
    const fraction = remainingPeriodFraction(sub.currentPeriodEnd, sub.billingCycle, this.deps.clock.now());
    const refundedCents = prorationAmountCents(0, priceCents(sub.plan, sub.billingCycle, sub.seats), fraction);
    if (refundedCents <= 0) return { refundedCents: 0 };
    const invoice = await this.stripe.invoices.retrieve(latestPaid.providerInvoiceId);
    // Basil moved `payment_intent` off the base Invoice type — read it via a local shape (the
    // `InvoiceSubscriptionMetadata` precedent). No paymentIntent resolvable → nothing to refund.
    const pi = (invoice as unknown as { payment_intent?: string | { id?: string } | null }).payment_intent;
    const paymentIntent = typeof pi === 'string' ? pi : pi?.id;
    if (!paymentIntent) return { refundedCents: 0 };
    const refund = await this.stripe.refunds.create({ payment_intent: paymentIntent, amount: refundedCents });
    return { refundedCents: refund.amount ?? refundedCents };
  }

  /** Resolve the org's Stripe subscription + its single line item id and product id. */
  private async resolveSubscriptionItem(
    orgId: string,
  ): Promise<{ subscriptionId: string; itemId: string; productId: string }> {
    const sub = await this.deps.subscriptions.findByOrg(orgId);
    if (!sub?.providerSubscriptionId) {
      throw new ApplicationError('VALIDATION', 'No billing account yet — complete a checkout first.');
    }
    const stripeSub = await this.stripe.subscriptions.retrieve(sub.providerSubscriptionId);
    const item = stripeSub.items.data[0];
    if (!item) {
      throw new ApplicationError('VALIDATION', 'The subscription has no line item to change.');
    }
    // Reuse the existing item's product (created inline at checkout) — the codebase keeps no
    // persistent Price/Product; we only vary the amount/interval.
    const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
    return { subscriptionId: sub.providerSubscriptionId, itemId: item.id, productId };
  }

  /** The inline subscription-item price for the target plan — mirrors the checkout price shape. */
  private subscriptionPriceData(
    req: ChangePlanRequest,
    productId: string,
  ): Stripe.SubscriptionUpdateParams.Item.PriceData {
    const monthly = priceCents(req.plan, 'MONTHLY', req.seats);
    const annual = req.cycle === 'ANNUAL';
    return {
      currency: 'usd',
      unit_amount: annual ? monthly * ANNUAL_MONTHS_CHARGED : monthly,
      recurring: { interval: annual ? 'year' : 'month' },
      product: productId,
    };
  }

  private async previewProrationAmount(
    item: { subscriptionId: string; itemId: string; productId: string },
    req: ChangePlanRequest,
  ): Promise<number> {
    const preview = await this.stripe.invoices.createPreview({
      subscription: item.subscriptionId,
      subscription_details: {
        items: [{ id: item.itemId, price_data: this.subscriptionPriceData(req, item.productId) }],
        proration_behavior: 'create_prorations',
      },
    });
    return sumProrationLines(preview);
  }

  async handleWebhook(sig: string, body: Buffer): Promise<void> {
    if (!this.opts.webhookSecret) {
      throw new ApplicationError('FORBIDDEN', 'Webhook signature verification is not configured.');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(body, sig, this.opts.webhookSecret);
    } catch {
      // Discard the SDK's message — nothing configuration-derived may leak (AC-PAY-08).
      throw new ApplicationError('FORBIDDEN', 'Invalid webhook signature.');
    }

    if (event.type === 'checkout.session.completed') {
      await this.applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      return;
    }
    const effect = INVOICE_WEBHOOK_EFFECTS[event.type];
    if (!effect) return; // Stripe emits many event types we don't consume — acknowledge them.
    await this.applyInvoiceEvent(event.data.object as Stripe.Invoice, effect.status, effect.subscriptionStatus);
  }

  private async applyCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const orgId = session.client_reference_id ?? session.metadata?.orgId ?? null;
    if (!orgId) return;
    const customer = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);
    const subscription =
      typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
    await this.deps.events.checkoutCompleted({
      orgId,
      providerCustomerId: customer,
      providerSubscriptionId: subscription,
    });
  }

  private async applyInvoiceEvent(
    invoice: Stripe.Invoice,
    status: InvoiceRecord['status'],
    subscriptionStatus?: Parameters<ApplyPaymentEvent['invoiceEvent']>[0]['subscriptionStatus'],
  ): Promise<void> {
    if (!invoice.id) return;
    const orgId = await this.resolveOrg(invoice);
    if (!orgId) return; // unresolvable tenant → acknowledge, or Stripe would retry forever
    await this.deps.events.invoiceEvent({
      orgId,
      providerInvoiceId: invoice.id,
      status,
      amountCents: invoice.total ?? 0,
      currency: invoice.currency ?? 'usd',
      periodStart: toDate(invoice.period_start),
      periodEnd: toDate(invoice.period_end),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
      subscriptionStatus,
    });
  }

  /** Tenant resolution order: invoice metadata → subscription metadata → providerCustomerId row. */
  private async resolveOrg(invoice: Stripe.Invoice): Promise<string | null> {
    const direct = invoice.metadata?.orgId;
    if (direct) return direct;
    const nested = invoice as unknown as InvoiceSubscriptionMetadata;
    const fromSubscription =
      nested.parent?.subscription_details?.metadata?.orgId ?? nested.subscription_details?.metadata?.orgId;
    if (fromSubscription) return fromSubscription;
    const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customer) return null;
    return (await this.deps.subscriptions.findByProviderCustomerId(customer))?.orgId ?? null;
  }
}

/**
 * The wiring entry point (both persistence modules): resolves the mode from env and returns the
 * mock (offline) or the Stripe adapter (auto). Both share the SAME deps — the ApplyPaymentEvent
 * seam and the local Invoice store — so swapping providers changes no other binding.
 */
export function paymentsFromEnv(env: NodeJS.ProcessEnv = process.env, deps: PaymentProviderDeps): PaymentProvider {
  if (resolvePaymentsMode(env) === 'offline') return new MockPaymentProvider(deps);
  return new StripePaymentProvider(stripeOptionsFromEnv(env), deps);
}
