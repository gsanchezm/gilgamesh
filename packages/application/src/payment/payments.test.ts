import { describe, expect, it } from 'vitest';
import { ApplicationError } from '../errors';
import type { SubscriptionRecord } from '../ports/records';
import { createInMemoryContext } from '../testing/in-memory';
import { ApplyPaymentEvent, INVOICE_WEBHOOK_EFFECTS } from './apply-payment-event';
import { MOCK_WEBHOOK_SIGNATURE, MockPaymentProvider } from './mock-payment-provider';

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

function setup() {
  const ctx = createInMemoryContext();
  const events = new ApplyPaymentEvent({ uow: ctx.uow, ids: ctx.ids, clock: ctx.clock });
  const provider = new MockPaymentProvider({ events, invoices: ctx.invoices, subscriptions: ctx.subscriptions });
  return { ctx, events, provider };
}

const webhook = (body: Record<string, unknown>) => Buffer.from(JSON.stringify(body), 'utf8');

describe('ApplyPaymentEvent', () => {
  it('inserts a new invoice with defaults and stamps clock time', async () => {
    const { ctx, events } = setup();
    await events.invoiceEvent({ orgId: 'org-1', providerInvoiceId: 'in_1', status: 'OPEN', amountCents: 4900 });

    const rows = await ctx.invoices.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: 'org-1',
      providerInvoiceId: 'in_1',
      status: 'OPEN',
      amountCents: 4900,
      currency: 'usd',
      hostedInvoiceUrl: null,
      createdAt: ctx.clock.now(),
    });
  });

  it('a redelivered/updated event mutates the SAME row — id, orgId and createdAt survive (AC-PAY-03)', async () => {
    const { ctx, events } = setup();
    await events.invoiceEvent({ orgId: 'org-1', providerInvoiceId: 'in_1', status: 'OPEN', amountCents: 4900 });
    const [first] = await ctx.invoices.listForOrg('org-1');
    ctx.clock.advance(60_000);
    await events.invoiceEvent({ orgId: 'org-1', providerInvoiceId: 'in_1', status: 'PAID', amountCents: 4900 });

    const rows = await ctx.invoices.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first!.id,
      orgId: 'org-1',
      status: 'PAID',
      createdAt: first!.createdAt,
      updatedAt: ctx.clock.now(),
    });
  });

  it('applies the subscription side-effect atomically with the invoice (AC-PAY-04)', async () => {
    const { ctx, events } = setup();
    await ctx.subscriptions.create(subscription());
    await events.invoiceEvent({
      orgId: 'org-1',
      providerInvoiceId: 'in_1',
      status: 'PAID',
      amountCents: 9900,
      subscriptionStatus: 'ACTIVE',
    });
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('ACTIVE');

    await events.invoiceEvent({
      orgId: 'org-1',
      providerInvoiceId: 'in_1',
      status: 'OPEN',
      amountCents: 9900,
      subscriptionStatus: 'PAST_DUE',
    });
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('PAST_DUE');
  });

  it('records the invoice even when the org has no subscription row', async () => {
    const { ctx, events } = setup();
    await events.invoiceEvent({
      orgId: 'org-1',
      providerInvoiceId: 'in_1',
      status: 'PAID',
      amountCents: 100,
      subscriptionStatus: 'ACTIVE',
    });
    expect(await ctx.invoices.listForOrg('org-1')).toHaveLength(1);
  });

  it('checkoutCompleted activates the subscription and stores the provider ids (S13-D)', async () => {
    const { ctx, events } = setup();
    await ctx.subscriptions.create(subscription());
    await events.checkoutCompleted({ orgId: 'org-1', providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1' });

    expect(await ctx.subscriptions.findByOrg('org-1')).toMatchObject({
      status: 'ACTIVE',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
    });
  });
});

describe('MockPaymentProvider payments surface', () => {
  it('confirmCheckout records a deterministic PAID invoice at the computed subscription price (AC-PAY-02)', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription({ plan: 'GROWTH', seats: 1 }));

    await provider.confirmCheckout('org-1');
    await provider.confirmCheckout('org-1'); // idempotent: the upsert hits the same row

    const rows = await ctx.invoices.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerInvoiceId: 'in_mock_org-1',
      status: 'PAID',
      amountCents: 9900,
      currency: 'usd',
      hostedInvoiceUrl: 'https://mock.pay/invoice/in_mock_org-1',
    });
  });

  it('listInvoices reads the local store (S13-C)', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    await provider.confirmCheckout('org-1');
    expect(await provider.listInvoices('org-1')).toEqual(await ctx.invoices.listForOrg('org-1'));
    expect(await provider.listInvoices('org-2')).toEqual([]);
  });

  it('createPortalSession returns a deterministic offline URL derived from the orgId (AC-PORTAL-06)', async () => {
    const { provider } = setup();
    expect(await provider.createPortalSession('org-1')).toEqual({ portalUrl: 'https://mock.pay/portal/org-1' });
    // Deterministic: identical input → identical output; distinct orgs → distinct URLs.
    expect(await provider.createPortalSession('org-1')).toEqual({ portalUrl: 'https://mock.pay/portal/org-1' });
    expect(await provider.createPortalSession('org-2')).toEqual({ portalUrl: 'https://mock.pay/portal/org-2' });
  });

  it('handleWebhook rejects a bad signature and persists nothing (AC-PAY-05)', async () => {
    const { ctx, provider } = setup();
    await expect(
      provider.handleWebhook('evil', webhook({ type: 'invoice.paid', orgId: 'org-1', providerInvoiceId: 'in_1', amountCents: 1 })),
    ).rejects.toMatchObject(new ApplicationError('FORBIDDEN', 'Invalid webhook signature.'));
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });

  it('handleWebhook applies the spec §3 mapping for every lifecycle event', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription());
    const deliver = (type: string) =>
      provider.handleWebhook(
        MOCK_WEBHOOK_SIGNATURE,
        webhook({ type, orgId: 'org-1', providerInvoiceId: 'in_1', amountCents: 4900 }),
      );

    await deliver('invoice.finalized');
    expect((await ctx.invoices.listForOrg('org-1'))[0]?.status).toBe('OPEN');

    await deliver('invoice.paid');
    expect((await ctx.invoices.listForOrg('org-1'))[0]?.status).toBe('PAID');
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('ACTIVE');

    await deliver('invoice.payment_failed');
    expect((await ctx.invoices.listForOrg('org-1'))[0]?.status).toBe('OPEN');
    expect((await ctx.subscriptions.findByOrg('org-1'))?.status).toBe('PAST_DUE');

    await deliver('invoice.voided');
    expect((await ctx.invoices.listForOrg('org-1'))[0]?.status).toBe('VOID');

    await deliver('invoice.marked_uncollectible');
    expect((await ctx.invoices.listForOrg('org-1'))[0]?.status).toBe('UNCOLLECTIBLE');

    expect(await ctx.invoices.listForOrg('org-1')).toHaveLength(1);
  });

  it('handleWebhook acknowledges unhandled event types without writing', async () => {
    const { ctx, provider } = setup();
    await provider.handleWebhook(MOCK_WEBHOOK_SIGNATURE, webhook({ type: 'customer.created', id: 'evt_1' }));
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });

  it('handleWebhook rejects malformed payloads and missing invoice fields with VALIDATION', async () => {
    const { provider } = setup();
    await expect(provider.handleWebhook(MOCK_WEBHOOK_SIGNATURE, Buffer.from('not-json'))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      provider.handleWebhook(MOCK_WEBHOOK_SIGNATURE, webhook({ type: 'invoice.paid', orgId: 'org-1' })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('INVOICE_WEBHOOK_EFFECTS', () => {
  it('covers exactly the spec §3 provider events', () => {
    expect(Object.keys(INVOICE_WEBHOOK_EFFECTS).sort()).toEqual([
      'invoice.finalized',
      'invoice.marked_uncollectible',
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.voided',
    ]);
  });
});
