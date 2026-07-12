import {
  ApplyPaymentEvent,
  createInMemoryContext,
  MockPaymentProvider,
  type SubscriptionRecord,
} from '@gilgamesh/application';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  paymentsFromEnv,
  resolvePaymentsMode,
  StripePaymentProvider,
  stripeOptionsFromEnv,
} from '../src/infra/stripe-payment-provider';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

const SECRET_KEY = 'sk_test_51_DUMMY_NEVER_REAL';
const WEBHOOK_SECRET = 'whsec_DUMMY_NEVER_REAL';

// constructEvent/generateTestHeaderString are pure local crypto — no network is ever involved.
const signer = new Stripe(SECRET_KEY);

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: 'sub-1',
    orgId: 'org-1',
    plan: 'GROWTH',
    billingCycle: 'MONTHLY',
    seats: 1,
    status: 'TRIALING',
    runMinutesQuota: 25000,
    runMinutesUsed: 0,
    brainTokensQuota: 10_000_000,
    brainTokensUsed: 0,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

function setup(opts: { webhookSecret?: string } = { webhookSecret: WEBHOOK_SECRET }, stripe?: Stripe) {
  const ctx = createInMemoryContext();
  const events = new ApplyPaymentEvent({ uow: ctx.uow, ids: ctx.ids, clock: ctx.clock });
  const provider = new StripePaymentProvider(
    {
      secretKey: SECRET_KEY,
      webhookSecret: opts.webhookSecret,
      successUrl: 'https://app.local/billing?checkout=success',
      cancelUrl: 'https://app.local/billing?checkout=canceled',
      portalReturnUrl: 'https://app.local/billing?from=portal',
    },
    { events, invoices: ctx.invoices, subscriptions: ctx.subscriptions, clock: ctx.clock },
    stripe,
  );
  return { ctx, provider };
}

function signed(payload: Record<string, unknown>): { body: Buffer; sig: string } {
  const json = JSON.stringify(payload);
  const sig = signer.webhooks.generateTestHeaderString({ payload: json, secret: WEBHOOK_SECRET });
  return { body: Buffer.from(json, 'utf8'), sig };
}

const invoiceEvent = (type: string, invoice: Record<string, unknown>) => ({
  id: 'evt_1',
  object: 'event',
  type,
  data: { object: { object: 'invoice', ...invoice } },
});

describe('provider selection (AC-PAY-07)', () => {
  it('resolvePaymentsMode mirrors the brain pattern: offline wins, a blank key is no key', () => {
    expect(resolvePaymentsMode(env({ PAYMENTS_MODE: 'offline', STRIPE_SECRET_KEY: SECRET_KEY }))).toBe('offline');
    expect(resolvePaymentsMode(env())).toBe('offline');
    expect(resolvePaymentsMode(env({ STRIPE_SECRET_KEY: '   ' }))).toBe('offline');
    expect(resolvePaymentsMode(env({ STRIPE_SECRET_KEY: SECRET_KEY }))).toBe('auto');
  });

  it('paymentsFromEnv binds the mock offline and Stripe in auto', () => {
    const ctx = createInMemoryContext();
    const deps = {
      events: new ApplyPaymentEvent({ uow: ctx.uow, ids: ctx.ids, clock: ctx.clock }),
      invoices: ctx.invoices,
      subscriptions: ctx.subscriptions,
      clock: ctx.clock,
    };
    expect(paymentsFromEnv(env(), deps)).toBeInstanceOf(MockPaymentProvider);
    expect(paymentsFromEnv(env({ PAYMENTS_MODE: 'offline', STRIPE_SECRET_KEY: SECRET_KEY }), deps)).toBeInstanceOf(
      MockPaymentProvider,
    );
    expect(paymentsFromEnv(env({ STRIPE_SECRET_KEY: SECRET_KEY }), deps)).toBeInstanceOf(StripePaymentProvider);
  });

  it('stripeOptionsFromEnv trims and defaults the redirect URLs', () => {
    const opts = stripeOptionsFromEnv(env({ STRIPE_SECRET_KEY: ` ${SECRET_KEY} `, STRIPE_WEBHOOK_SECRET: '' }));
    expect(opts.secretKey).toBe(SECRET_KEY);
    expect(opts.webhookSecret).toBeUndefined();
    expect(opts.successUrl).toContain('/billing');
    expect(opts.cancelUrl).toContain('/billing');
    // S34: portalReturnUrl defaults to the success URL when unset.
    expect(opts.portalReturnUrl).toBe(opts.successUrl);
  });

  it('stripeOptionsFromEnv takes an explicit STRIPE_PORTAL_RETURN_URL over the success default (S34)', () => {
    const opts = stripeOptionsFromEnv(
      env({ STRIPE_SECRET_KEY: SECRET_KEY, STRIPE_PORTAL_RETURN_URL: ' https://app.local/account ' }),
    );
    expect(opts.portalReturnUrl).toBe('https://app.local/account');
  });
});

describe('StripePaymentProvider.handleWebhook (AC-PAY-03/04/05/08)', () => {
  it('verifies the signature and applies invoice.paid: invoice PAID + subscription ACTIVE', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    const { body, sig } = signed(
      invoiceEvent('invoice.paid', {
        id: 'in_123',
        total: 9900,
        currency: 'usd',
        customer: 'cus_1',
        metadata: { orgId: 'org-1' },
        hosted_invoice_url: 'https://invoice.stripe.com/i/in_123',
        invoice_pdf: 'https://pay.stripe.com/invoice/in_123/pdf',
        period_start: 1751760000,
        period_end: 1754438400,
      }),
    );

    await provider.handleWebhook(sig, body);

    const rows = await ctx.invoices.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerInvoiceId: 'in_123',
      status: 'PAID',
      amountCents: 9900,
      currency: 'usd',
      hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_123',
      pdfUrl: 'https://pay.stripe.com/invoice/in_123/pdf',
      periodStart: new Date(1751760000 * 1000),
      periodEnd: new Date(1754438400 * 1000),
    });
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('ACTIVE');
  });

  it('resolves the org via providerCustomerId when the event carries no orgId metadata', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription({ providerCustomerId: 'cus_42' }));
    const { body, sig } = signed(
      invoiceEvent('invoice.payment_failed', { id: 'in_9', total: 2900, currency: 'usd', customer: 'cus_42' }),
    );

    await provider.handleWebhook(sig, body);

    expect((await ctx.invoices.listForOrg('org-1'))[0]).toMatchObject({ providerInvoiceId: 'in_9', status: 'OPEN' });
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('PAST_DUE');
  });

  it('acknowledges events for unresolvable orgs and unhandled types without writing', async () => {
    const { ctx, provider } = setup();
    const orphan = signed(invoiceEvent('invoice.paid', { id: 'in_ghost', total: 1, currency: 'usd', customer: 'cus_none' }));
    await provider.handleWebhook(orphan.sig, orphan.body);
    const other = signed({ id: 'evt_2', object: 'event', type: 'customer.created', data: { object: { id: 'cus_9' } } });
    await provider.handleWebhook(other.sig, other.body);
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });

  it('checkout.session.completed activates the subscription with the provider ids (S13-D)', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    const { body, sig } = signed({
      id: 'evt_3',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: { object: 'checkout.session', client_reference_id: 'org-1', customer: 'cus_7', subscription: 'sub_7' },
      },
    });

    await provider.handleWebhook(sig, body);

    expect(await ctx.subscriptions.findByOrg('org-1')).toMatchObject({
      status: 'ACTIVE',
      providerCustomerId: 'cus_7',
      providerSubscriptionId: 'sub_7',
    });

    // The confirm flow then just echoes the webhook-stored ids.
    expect(await provider.confirmCheckout('org-1')).toEqual({
      providerCustomerId: 'cus_7',
      providerSubscriptionId: 'sub_7',
    });
  });

  it('rejects a tampered signature with FORBIDDEN, persists nothing, and never leaks a secret (AC-PAY-05/08)', async () => {
    const { ctx, provider } = setup();
    const { body } = signed(invoiceEvent('invoice.paid', { id: 'in_bad', total: 1, currency: 'usd', metadata: { orgId: 'org-1' } }));

    let failure: Error | null = null;
    try {
      await provider.handleWebhook('t=1,v1=deadbeef', body);
    } catch (e) {
      failure = e as Error;
    }
    expect(failure).toMatchObject({ code: 'FORBIDDEN' });
    expect(failure?.message).not.toContain(WEBHOOK_SECRET);
    expect(failure?.message).not.toContain(SECRET_KEY);
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });

  it('refuses to process webhooks when no webhook secret is configured', async () => {
    const { provider } = setup({ webhookSecret: undefined });
    const { body, sig } = signed(invoiceEvent('invoice.paid', { id: 'in_1', total: 1, currency: 'usd' }));
    await expect(provider.handleWebhook(sig, body)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('StripePaymentProvider checkout + invoices', () => {
  function fakeStripe() {
    const create = vi.fn(async (_params: Record<string, unknown>) => ({
      url: 'https://checkout.stripe.com/c/cs_test_123',
    }));
    return { stripe: { checkout: { sessions: { create } } } as unknown as Stripe, create };
  }

  it('creates a subscription-mode Checkout Session priced by the domain catalog', async () => {
    const { stripe, create } = fakeStripe();
    const { provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);

    const res = await provider.createCheckout({ orgId: 'org-1', plan: 'GROWTH', cycle: 'MONTHLY', seats: 1 });
    expect(res).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/cs_test_123' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        client_reference_id: 'org-1',
        metadata: { orgId: 'org-1' },
        subscription_data: { metadata: { orgId: 'org-1' } },
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 9900,
              recurring: { interval: 'month' },
            }),
          }),
        ],
      }),
    );
  });

  it('annual checkout charges 10 months as one yearly amount (keystone §9)', async () => {
    const { stripe, create } = fakeStripe();
    const { provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);

    await provider.createCheckout({ orgId: 'org-1', plan: 'SCALE', cycle: 'ANNUAL', seats: 12 });
    const params = create.mock.calls[0]?.[0] as unknown as {
      line_items: { price_data: { unit_amount: number; recurring: { interval: string } } }[];
    };
    expect(params.line_items[0]?.price_data.unit_amount).toBe(69700 * 10); // (49900 + 2×9900) × 10 charged months
    expect(params.line_items[0]?.price_data.recurring.interval).toBe('year');
  });

  it('rejects a FREE checkout (nothing to charge)', async () => {
    const { stripe } = fakeStripe();
    const { provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await expect(provider.createCheckout({ orgId: 'org-1', plan: 'FREE', cycle: 'MONTHLY', seats: 1 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('confirmCheckout before the webhook lands fails with VALIDATION', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    await expect(provider.confirmCheckout('org-1')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('listInvoices reads the local webhook-fed store (S13-C)', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    const { body, sig } = signed(
      invoiceEvent('invoice.finalized', { id: 'in_5', total: 500, currency: 'usd', metadata: { orgId: 'org-1' } }),
    );
    await provider.handleWebhook(sig, body);
    expect(await provider.listInvoices('org-1')).toEqual(await ctx.invoices.listForOrg('org-1'));
  });
});

describe('StripePaymentProvider.createPortalSession (AC-PORTAL-01/04/08)', () => {
  function fakePortalStripe(url: string | null = 'https://billing.stripe.com/p/session_123') {
    const create = vi.fn(async (_params: Record<string, unknown>) => ({ url }));
    return { stripe: { billingPortal: { sessions: { create } } } as unknown as Stripe, create };
  }

  function setupPortal(stripe: Stripe) {
    const ctx = createInMemoryContext();
    const events = new ApplyPaymentEvent({ uow: ctx.uow, ids: ctx.ids, clock: ctx.clock });
    const provider = new StripePaymentProvider(
      {
        secretKey: SECRET_KEY,
        webhookSecret: WEBHOOK_SECRET,
        successUrl: 'https://app.local/billing?checkout=success',
        cancelUrl: 'https://app.local/billing?checkout=canceled',
        portalReturnUrl: 'https://app.local/billing?from=portal',
      },
      { events, invoices: ctx.invoices, subscriptions: ctx.subscriptions, clock: ctx.clock },
      stripe,
    );
    return { ctx, provider };
  }

  it('mints a portal session for the org customer with the configured return_url', async () => {
    const { stripe, create } = fakePortalStripe();
    const { ctx, provider } = setupPortal(stripe);
    await ctx.subscriptions.create(subscription({ providerCustomerId: 'cus_live_1' }));

    const res = await provider.createPortalSession('org-1');
    expect(res).toEqual({ portalUrl: 'https://billing.stripe.com/p/session_123' });
    expect(create).toHaveBeenCalledWith({ customer: 'cus_live_1', return_url: 'https://app.local/billing?from=portal' });
  });

  it('rejects with VALIDATION and never calls Stripe when the org has no provider customer (AC-PORTAL-04)', async () => {
    const { stripe, create } = fakePortalStripe();
    const { ctx, provider } = setupPortal(stripe);
    await ctx.subscriptions.create(subscription({ providerCustomerId: null }));
    await expect(provider.createPortalSession('org-1')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects with VALIDATION when Stripe returns no portal url, and never leaks a secret (AC-PORTAL-08)', async () => {
    const { stripe } = fakePortalStripe(null);
    const { ctx, provider } = setupPortal(stripe);
    await ctx.subscriptions.create(subscription({ providerCustomerId: 'cus_live_2' }));

    let failure: Error | null = null;
    try {
      await provider.createPortalSession('org-1');
    } catch (e) {
      failure = e as Error;
    }
    expect(failure).toMatchObject({ code: 'VALIDATION' });
    expect(failure?.message).not.toContain(SECRET_KEY);
    expect(failure?.message).not.toContain(WEBHOOK_SECRET);
  });
});

describe('StripePaymentProvider proration + refunds (slice 40, AC-PRORATE-01/02/04/05/07)', () => {
  // A fake Stripe whose subscription has one item (si_1) on product prod_1, and whose upcoming-invoice
  // preview carries exactly one proration line of 4000 (a second non-proration line is ignored).
  function fakeProrationStripe() {
    const retrieveSub = vi.fn(async (_id: string) => ({ items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] } }));
    const update = vi.fn(async (_id: string, _params: Record<string, unknown>) => ({ id: 'sub_1' }));
    const createPreview = vi.fn(async (_params: Record<string, unknown>) => ({
      lines: {
        data: [
          { amount: 4000, parent: { subscription_item_details: { proration: true } } },
          { amount: 12000, parent: { subscription_item_details: { proration: false } } },
        ],
      },
    }));
    const stripe = {
      subscriptions: { retrieve: retrieveSub, update },
      invoices: { createPreview },
    } as unknown as Stripe;
    return { stripe, retrieveSub, update, createPreview };
  }

  function fakeRefundStripe(paymentIntent: string | null = 'pi_1') {
    const retrieveInvoice = vi.fn(async (_id: string) => ({ payment_intent: paymentIntent }));
    const refundCreate = vi.fn(async (params: { amount?: number }) => ({ id: 're_1', amount: params.amount }));
    const stripe = {
      invoices: { retrieve: retrieveInvoice },
      refunds: { create: refundCreate },
    } as unknown as Stripe;
    return { stripe, retrieveInvoice, refundCreate };
  }

  const provisioned = (overrides: Partial<SubscriptionRecord> = {}) =>
    subscription({
      plan: 'GROWTH',
      billingCycle: 'MONTHLY',
      seats: 1,
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      ...overrides,
    });

  it('previews the summed proration lines via createPreview with the target price_data', async () => {
    const { stripe, createPreview } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(provisioned());

    const res = await provider.previewProration({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1 });
    expect(res).toEqual({ prorationCents: 4000 });
    expect(createPreview).toHaveBeenCalledWith({
      subscription: 'sub_1',
      subscription_details: {
        items: [
          {
            id: 'si_1',
            price_data: {
              currency: 'usd',
              unit_amount: 49900, // SCALE monthly
              recurring: { interval: 'month' },
              product: 'prod_1',
            },
          },
        ],
        proration_behavior: 'create_prorations',
      },
    });
  });

  it('applies the change via subscriptions.update with create_prorations, returning the previewed amount', async () => {
    const { stripe, update } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(provisioned());

    const res = await provider.changePlan({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1 });
    expect(res).toEqual({ prorationCents: 4000 });
    expect(update).toHaveBeenCalledWith('sub_1', {
      items: [
        {
          id: 'si_1',
          price_data: { currency: 'usd', unit_amount: 49900, recurring: { interval: 'month' }, product: 'prod_1' },
        },
      ],
      proration_behavior: 'create_prorations',
    });
  });

  it('prices an annual change at 10 charged months (keystone §9)', async () => {
    const { stripe, update } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(provisioned());
    await provider.changePlan({ orgId: 'org-1', plan: 'GROWTH', cycle: 'ANNUAL', seats: 1 });
    const params = update.mock.calls[0]?.[1] as unknown as { items: { price_data: { unit_amount: number; recurring: { interval: string } } }[] };
    expect(params.items[0]?.price_data.unit_amount).toBe(9900 * 10); // GROWTH × 10 charged months
    expect(params.items[0]?.price_data.recurring.interval).toBe('year');
  });

  it('rejects a proration on an org with no provider subscription (VALIDATION, never leaks a secret)', async () => {
    const { stripe } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(subscription({ providerSubscriptionId: null }));
    let failure: Error | null = null;
    try {
      await provider.previewProration({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1 });
    } catch (e) {
      failure = e as Error;
    }
    expect(failure).toMatchObject({ code: 'VALIDATION' });
    expect(failure?.message).not.toContain(SECRET_KEY);
    expect(failure?.message).not.toContain(WEBHOOK_SECRET);
  });

  it('refunds the prorated unused portion against the latest paid invoice payment intent (AC-PRORATE-05)', async () => {
    const { stripe, retrieveInvoice, refundCreate } = fakeRefundStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    // Half of the 30-day period remaining from the FakeClock's now → fraction 0.5, GROWTH 9900 → 4950.
    const currentPeriodEnd = new Date(ctx.clock.now().getTime() + 15 * 24 * 60 * 60 * 1000);
    await ctx.subscriptions.create(provisioned({ currentPeriodEnd }));
    await ctx.invoices.upsertByProviderInvoiceId({
      id: 'inv-paid-1',
      orgId: 'org-1',
      providerInvoiceId: 'in_paid_1',
      status: 'PAID',
      amountCents: 9900,
      currency: 'usd',
      periodStart: null,
      periodEnd: null,
      hostedInvoiceUrl: null,
      pdfUrl: null,
      createdAt: ctx.clock.now(),
      updatedAt: ctx.clock.now(),
    });

    const res = await provider.refund({ orgId: 'org-1', reason: 'cancellation' });
    expect(res).toEqual({ refundedCents: 4950 });
    expect(retrieveInvoice).toHaveBeenCalledWith('in_paid_1');
    expect(refundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 4950 });
    // No-leak: neither the result nor the recorded rows carry the secret (AC-PRORATE-07).
    expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(await ctx.invoices.listForOrg('org-1'))).not.toContain(SECRET_KEY);
  });

  it('refunds 0 without calling Stripe when there is no paid invoice', async () => {
    const { stripe, refundCreate } = fakeRefundStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    const currentPeriodEnd = new Date(ctx.clock.now().getTime() + 15 * 24 * 60 * 60 * 1000);
    await ctx.subscriptions.create(provisioned({ currentPeriodEnd }));
    const res = await provider.refund({ orgId: 'org-1', reason: 'cancellation' });
    expect(res).toEqual({ refundedCents: 0 });
    expect(refundCreate).not.toHaveBeenCalled();
  });
});

describe('StripePaymentProvider partial refunds + always_invoice (slice 41, AC-REFUND-01/02/03/04/06)', () => {
  function fakeRefundStripe(paymentIntent: string | null = 'pi_1') {
    const retrieveInvoice = vi.fn(async (_id: string) => ({ payment_intent: paymentIntent }));
    const refundCreate = vi.fn(async (params: { amount?: number }) => ({ id: 're_1', amount: params.amount }));
    const stripe = {
      invoices: { retrieve: retrieveInvoice },
      refunds: { create: refundCreate },
    } as unknown as Stripe;
    return { stripe, retrieveInvoice, refundCreate };
  }

  function fakeProrationStripe() {
    const retrieveSub = vi.fn(async (_id: string) => ({ items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] } }));
    const update = vi.fn(async (_id: string, _params: Record<string, unknown>) => ({ id: 'sub_1' }));
    const createPreview = vi.fn(async (_params: Record<string, unknown>) => ({
      lines: { data: [{ amount: 4000, parent: { subscription_item_details: { proration: true } } }] },
    }));
    const stripe = { subscriptions: { retrieve: retrieveSub, update }, invoices: { createPreview } } as unknown as Stripe;
    return { stripe, update };
  }

  const provisioned = (overrides: Partial<SubscriptionRecord> = {}) =>
    subscription({ plan: 'GROWTH', providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1', ...overrides });

  /** Seed a PAID invoice at 9900 → the partial-refund ceiling. */
  async function seedPaid(ctx: ReturnType<typeof createInMemoryContext>) {
    await ctx.subscriptions.create(provisioned());
    await ctx.invoices.upsertByProviderInvoiceId({
      id: 'inv-paid-1',
      orgId: 'org-1',
      providerInvoiceId: 'in_paid_1',
      status: 'PAID',
      amountCents: 9900,
      currency: 'usd',
      periodStart: null,
      periodEnd: null,
      hostedInvoiceUrl: null,
      pdfUrl: null,
      createdAt: ctx.clock.now(),
      updatedAt: ctx.clock.now(),
    });
  }

  it('refunds exactly the requested amount against the paid invoice payment intent (AC-REFUND-01)', async () => {
    const { stripe, retrieveInvoice, refundCreate } = fakeRefundStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await seedPaid(ctx);

    const res = await provider.refund({ orgId: 'org-1', amountCents: 5000, reason: 'manual' });
    expect(res).toEqual({ refundedCents: 5000 });
    expect(retrieveInvoice).toHaveBeenCalledWith('in_paid_1');
    expect(refundCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 5000 });
    // No-leak (AC-REFUND-06): the result never carries the secret.
    expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(await ctx.invoices.listForOrg('org-1'))).not.toContain(SECRET_KEY);
  });

  it('previewRefund reports the ceiling + clamped amount without any Stripe write (AC-REFUND-02)', async () => {
    const { stripe, retrieveInvoice, refundCreate } = fakeRefundStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await seedPaid(ctx);

    expect(await provider.previewRefund({ orgId: 'org-1', amountCents: 4200 })).toEqual({
      refundableCents: 9900,
      amountCents: 4200,
    });
    expect(retrieveInvoice).not.toHaveBeenCalled();
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('rejects an over-ceiling refund with VALIDATION, never calls refunds.create, never leaks (AC-REFUND-03/06)', async () => {
    const { stripe, refundCreate } = fakeRefundStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await seedPaid(ctx);

    let failure: Error | null = null;
    try {
      await provider.refund({ orgId: 'org-1', amountCents: 20000 });
    } catch (e) {
      failure = e as Error;
    }
    expect(failure).toMatchObject({ code: 'VALIDATION' });
    expect(failure?.message).not.toContain(SECRET_KEY);
    expect(failure?.message).not.toContain(WEBHOOK_SECRET);
    expect(refundCreate).not.toHaveBeenCalled();
  });

  it('applies always_invoice on a plan change (AC-REFUND-04)', async () => {
    const { stripe, update } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(provisioned());
    await provider.changePlan({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1, prorationBehavior: 'always_invoice' });
    expect(update).toHaveBeenCalledWith('sub_1', expect.objectContaining({ proration_behavior: 'always_invoice' }));
  });

  it('defaults to create_prorations when no behavior is given (regression-safe)', async () => {
    const { stripe, update } = fakeProrationStripe();
    const { ctx, provider } = setup({ webhookSecret: WEBHOOK_SECRET }, stripe);
    await ctx.subscriptions.create(provisioned());
    await provider.changePlan({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1 });
    expect(update).toHaveBeenCalledWith('sub_1', expect.objectContaining({ proration_behavior: 'create_prorations' }));
  });
});
