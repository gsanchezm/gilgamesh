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
  // S40: the clock drives deterministic proration, mirroring the production payment wiring.
  const provider = new MockPaymentProvider({
    events,
    invoices: ctx.invoices,
    subscriptions: ctx.subscriptions,
    clock: ctx.clock,
  });
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
  it('covers the spec §3 invoice events plus the slice-40 refund events', () => {
    expect(Object.keys(INVOICE_WEBHOOK_EFFECTS).sort()).toEqual([
      'charge.refunded',
      'credit_note.created',
      'invoice.finalized',
      'invoice.marked_uncollectible',
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.voided',
    ]);
    // The refund events void the invoice (owner decision B-2 reflection).
    expect(INVOICE_WEBHOOK_EFFECTS['charge.refunded']).toEqual({ status: 'VOID' });
    expect(INVOICE_WEBHOOK_EFFECTS['credit_note.created']).toEqual({ status: 'VOID' });
  });
});

describe('MockPaymentProvider proration + refunds (slice 40)', () => {
  // A checked-out GROWTH sub, monthly, with exactly half the 30-day period remaining from the
  // FakeClock's default now (2026-06-29T12:00:00Z + 15 days) → remaining fraction 0.5.
  function prorated(overrides: Partial<SubscriptionRecord> = {}) {
    const { ctx, provider } = setup();
    const now = ctx.clock.now();
    const currentPeriodEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    const sub = subscription({
      plan: 'GROWTH',
      billingCycle: 'MONTHLY',
      seats: 1,
      providerCustomerId: 'cus_mock_org-1',
      providerSubscriptionId: 'sub_mock_org-1',
      currentPeriodEnd,
      ...overrides,
    });
    return { ctx, provider, sub };
  }

  it('previews a positive proration on an upgrade without mutating any row (AC-PRORATE-01/04)', async () => {
    const { ctx, provider, sub } = prorated();
    await ctx.subscriptions.create(sub);
    const before = JSON.stringify(await ctx.invoices.listForOrg('org-1'));

    // (49900 SCALE − 9900 GROWTH) × 0.5 = 20000.
    const preview = await provider.previewProration({ orgId: 'org-1', plan: 'SCALE', cycle: 'MONTHLY', seats: 1 });
    expect(preview.prorationCents).toBe(20000);

    // Read-only: no invoice recorded, the subscription is untouched.
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
    expect(JSON.stringify(await ctx.invoices.listForOrg('org-1'))).toBe(before);
    expect((await ctx.subscriptions.findByOrg('org-1'))?.plan).toBe('GROWTH');
  });

  it('applies the SAME amount changePlan records as an OPEN invoice (AC-PRORATE-04)', async () => {
    const { ctx, provider, sub } = prorated();
    await ctx.subscriptions.create(sub);
    const req = { orgId: 'org-1', plan: 'SCALE' as const, cycle: 'MONTHLY' as const, seats: 1 };

    const preview = await provider.previewProration(req);
    const change = await provider.changePlan(req);
    expect(change.prorationCents).toBe(preview.prorationCents);
    expect(change.prorationCents).toBe(20000);

    const rows = await ctx.invoices.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerInvoiceId: 'in_mock_prorate_org-1',
      status: 'OPEN',
      amountCents: 20000,
    });
  });

  it('produces a negative proration (credit) on a downgrade (AC-PRORATE-02)', async () => {
    const { ctx, provider, sub } = prorated();
    await ctx.subscriptions.create(sub);
    // (2900 STARTER − 9900 GROWTH) × 0.5 = -3500.
    const change = await provider.changePlan({ orgId: 'org-1', plan: 'STARTER', cycle: 'MONTHLY', seats: 1 });
    expect(change.prorationCents).toBe(-3500);
    expect((await ctx.invoices.listForOrg('org-1'))[0]).toMatchObject({ status: 'OPEN', amountCents: -3500 });
  });

  it('returns 0 and records nothing when there is no provider subscription / period (AC-PRORATE-03)', async () => {
    const { ctx, provider } = setup();
    // A fresh FREE sub: no currentPeriodEnd → fraction 0 → proration 0, and no invoice recorded.
    await ctx.subscriptions.create(subscription({ plan: 'FREE', currentPeriodEnd: null }));
    expect((await provider.previewProration({ orgId: 'org-1', plan: 'GROWTH', cycle: 'MONTHLY', seats: 1 })).prorationCents).toBe(0);
    expect((await provider.changePlan({ orgId: 'org-1', plan: 'GROWTH', cycle: 'MONTHLY', seats: 1 })).prorationCents).toBe(0);
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });

  it('refunds the prorated unused portion as a credit VOID invoice when a paid invoice exists (AC-PRORATE-05)', async () => {
    const { ctx, provider, sub } = prorated();
    await ctx.subscriptions.create(sub);
    await provider.confirmCheckout('org-1'); // records the PAID checkout invoice at 9900

    // round(9900 × 0.5) = 4950.
    const res = await provider.refund({ orgId: 'org-1', reason: 'cancellation' });
    expect(res.refundedCents).toBe(4950);

    const credit = (await ctx.invoices.listForOrg('org-1')).find((i) => i.providerInvoiceId === 'in_mock_refund_org-1');
    expect(credit).toMatchObject({ status: 'VOID', amountCents: -4950 });
  });

  it('refunds 0 and records nothing when there is no paid invoice (AC-PRORATE-05 edge)', async () => {
    const { ctx, provider, sub } = prorated();
    await ctx.subscriptions.create(sub); // no PAID invoice recorded
    const res = await provider.refund({ orgId: 'org-1', reason: 'cancellation' });
    expect(res.refundedCents).toBe(0);
    expect(await ctx.invoices.listForOrg('org-1')).toEqual([]);
  });
});

describe('MockPaymentProvider partial refunds (slice 41)', () => {
  /** A GROWTH sub with a PAID checkout invoice at 9900 → a refundable ceiling of 9900. */
  async function paidGrowth() {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(
      subscription({ plan: 'GROWTH', providerCustomerId: 'cus_mock_org-1', providerSubscriptionId: 'sub_mock_org-1' }),
    );
    await provider.confirmCheckout('org-1'); // records the PAID invoice at 9900
    return { ctx, provider };
  }

  it('refunds exactly the requested amount and records a credit VOID invoice (AC-REFUND-01)', async () => {
    const { ctx, provider } = await paidGrowth();
    const res = await provider.refund({ orgId: 'org-1', amountCents: 5000, reason: 'manual' });
    expect(res).toEqual({ refundedCents: 5000 });

    const credit = (await ctx.invoices.listForOrg('org-1')).find((i) =>
      String(i.providerInvoiceId).startsWith('in_mock_refund_partial_org-1'),
    );
    expect(credit).toMatchObject({ status: 'VOID', amountCents: -5000, providerInvoiceId: 'in_mock_refund_partial_org-1_0' });
  });

  it('previewRefund reports the ceiling + the (same) amount refund then charges, mutating nothing (AC-REFUND-02)', async () => {
    const { ctx, provider } = await paidGrowth();
    const before = JSON.stringify(await ctx.invoices.listForOrg('org-1'));

    const preview = await provider.previewRefund({ orgId: 'org-1', amountCents: 4200 });
    expect(preview).toEqual({ refundableCents: 9900, amountCents: 4200 });
    // Read-only: no new row.
    expect(JSON.stringify(await ctx.invoices.listForOrg('org-1'))).toBe(before);

    const executed = await provider.refund({ orgId: 'org-1', amountCents: 4200 });
    expect(executed.refundedCents).toBe(preview.amountCents);
  });

  it('previewRefund with no amount quotes a full refund of the ceiling', async () => {
    const { provider } = await paidGrowth();
    expect(await provider.previewRefund({ orgId: 'org-1' })).toEqual({ refundableCents: 9900, amountCents: 9900 });
  });

  it('rejects an over-ceiling refund with VALIDATION and records nothing (AC-REFUND-03)', async () => {
    const { ctx, provider } = await paidGrowth();
    await expect(provider.refund({ orgId: 'org-1', amountCents: 20000 })).rejects.toMatchObject({ code: 'VALIDATION' });
    // No credit row was written.
    expect((await ctx.invoices.listForOrg('org-1')).some((i) => String(i.providerInvoiceId).includes('refund'))).toBe(false);
  });

  it('rejects a partial refund with VALIDATION when there is no paid invoice (ceiling 0)', async () => {
    const { ctx, provider } = setup();
    await ctx.subscriptions.create(subscription({ providerCustomerId: 'cus_mock_org-1' })); // no PAID invoice
    await expect(provider.refund({ orgId: 'org-1', amountCents: 100 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('records successive partial refunds under distinct keys (no collision)', async () => {
    const { ctx, provider } = await paidGrowth();
    await provider.refund({ orgId: 'org-1', amountCents: 3000 });
    await provider.refund({ orgId: 'org-1', amountCents: 2000 });
    const keys = (await ctx.invoices.listForOrg('org-1'))
      .map((i) => String(i.providerInvoiceId))
      .filter((k) => k.startsWith('in_mock_refund_partial_org-1'))
      .sort();
    expect(keys).toEqual(['in_mock_refund_partial_org-1_0', 'in_mock_refund_partial_org-1_1']);
  });

  it('leaves the slice-40 cancellation path (no amount) byte-for-byte and on its own key', async () => {
    const { ctx, provider } = await paidGrowth();
    // Half the 30-day period remaining → fraction 0.5, GROWTH 9900 → 4950 unused-portion credit.
    const sub = (await ctx.subscriptions.findByOrg('org-1'))!;
    await ctx.subscriptions.save({ ...sub, currentPeriodEnd: new Date(ctx.clock.now().getTime() + 15 * 24 * 60 * 60 * 1000) });

    const res = await provider.refund({ orgId: 'org-1', reason: 'cancellation' });
    expect(res.refundedCents).toBe(4950);
    const credit = (await ctx.invoices.listForOrg('org-1')).find((i) => i.providerInvoiceId === 'in_mock_refund_org-1');
    expect(credit).toMatchObject({ status: 'VOID', amountCents: -4950 });
  });
});
