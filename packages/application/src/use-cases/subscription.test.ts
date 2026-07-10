import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GetOrgSubscription } from './org-queries';
import { RegisterUser } from './register-user';
import {
  CancelSubscription,
  ChangeSubscription,
  ConfirmCheckout,
  PreviewPlanChange,
  StartBillingPortal,
  StartCheckout,
  UpdateSeats,
} from './subscription';

describe('Subscription & Billing', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    orgId = (await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })).orgId;
  });

  it('views the seeded subscription with limits + usage (AC-SUB-01)', async () => {
    const v = await new GetOrgSubscription(ctx).execute({ userId, orgId });
    expect(v).toMatchObject({
      plan: 'FREE',
      status: 'TRIALING',
      maxSeats: 1,
      maxServicesPerWorkspace: 2,
      unlimited: false,
      runMinutesQuota: 500,
      // S14: onboarding seeds the FREE AI token allowance (derived from the catalog).
      brainTokensQuota: 100_000,
      brainTokensUsed: 0,
      brainTokensUnlimited: false,
    });
  });

  // ---- Slice 14: token quota on the subscription (AC-TOKB-01/07) ----

  it('a plan change remaps the token quota from the catalog and PRESERVES the usage (AC-TOKB-01)', async () => {
    // Through the charge path — save() no longer persists the counters (review S14 #1).
    await ctx.subscriptions.chargeBrainTokens(orgId, 12_345);

    const starter = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER' });
    expect(starter).toMatchObject({ brainTokensQuota: 2_000_000, brainTokensUsed: 12_345 });
    const growth = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'GROWTH' });
    expect(growth).toMatchObject({ brainTokensQuota: 10_000_000, brainTokensUsed: 12_345 });
    const scale = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'SCALE' });
    expect(scale).toMatchObject({ brainTokensUnlimited: true, brainTokensUsed: 12_345 });
  });

  it('checkout confirmation preserves the token counter — no rollover reset exists (AC-TOKB-07)', async () => {
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.chargeBrainTokens(orgId, 777);
    await new StartCheckout(ctx).execute({ userId, orgId });
    const v = await new ConfirmCheckout(ctx).execute({ userId, orgId });
    // Exactly the executions behavior (spec 14 §4): activation never resets the monthly counters.
    expect(v.brainTokensUsed).toBe(777);
    expect(v.runMinutesUsed).toBe(sub.runMinutesUsed);
  });

  it('changes the plan and remaps execution quota + workspace cap (AC-SUB-02)', async () => {
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'GROWTH' });
    expect(v).toMatchObject({ plan: 'GROWTH', runMinutesQuota: 25000, maxServicesPerWorkspace: 15 });
  });

  it('updates active workspaces within the plan cap, rejects over it (AC-SUB-04)', async () => {
    await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER' });
    expect((await new UpdateSeats(ctx).execute({ userId, orgId, seats: 4 })).seats).toBe(4);
    const sub = await ctx.subscriptions.findByOrg(orgId);
    await ctx.subscriptions.save({ ...sub!, plan: 'FREE', runMinutesQuota: 500, seats: 1 });
    await expect(new UpdateSeats(ctx).execute({ userId, orgId, seats: 2 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a plan change whose workspace cap is below current active workspaces (AC-SUB-03)', async () => {
    await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER' });
    await new UpdateSeats(ctx).execute({ userId, orgId, seats: 8 });
    await expect(new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'FREE' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('checkout (mock) returns a url, then confirm activates with provider ids (AC-SUB-05/11)', async () => {
    const { checkoutUrl } = await new StartCheckout(ctx).execute({ userId, orgId });
    expect(checkoutUrl).toMatch(/^https:\/\/mock\.pay\/checkout\//);
    const v = await new ConfirmCheckout(ctx).execute({ userId, orgId });
    expect(v.status).toBe('ACTIVE');
    expect(v.providerCustomerId).toMatch(/^cus_mock_/);
    expect(v.currentPeriodEnd).toBeInstanceOf(Date);
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.activated')).toBe(true);
  });

  it('allows a self-service upgrade to Scale', async () => {
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'SCALE' });
    expect(v).toMatchObject({ plan: 'SCALE', unlimited: true, includedWorkspaces: 10 });
  });

  it('cancels the subscription (AC-SUB-06)', async () => {
    expect((await new CancelSubscription(ctx).execute({ userId, orgId })).status).toBe('CANCELED');
  });

  // ---- Slice 40: Stripe proration + refunds ----

  /** Onboard → GROWTH → checkout+confirm, so the org has a provider subscription + a paid invoice. */
  async function provisionGrowth(): Promise<void> {
    await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'GROWTH' });
    await new StartCheckout(ctx).execute({ userId, orgId });
    await new ConfirmCheckout(ctx).execute({ userId, orgId }); // currentPeriodEnd = now + 30d, PAID invoice 9900
  }

  it('prorates an upgrade on a provisioned subscription and audits it (AC-PRORATE-01)', async () => {
    await provisionGrowth();
    // Full period remaining (clock unadvanced): (49900 SCALE − 9900 GROWTH) × 1.0 = 40000.
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'SCALE' });
    expect(v.plan).toBe('SCALE');
    expect(v.prorationCents).toBe(40000);
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.plan_prorated' && r.metadata.prorationCents === 40000)).toBe(true);
  });

  it('prorates a downgrade as a negative credit (AC-PRORATE-02)', async () => {
    await provisionGrowth();
    // (2900 STARTER − 9900 GROWTH) × 1.0 = -7000.
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER' });
    expect(v.prorationCents).toBe(-7000);
  });

  it('applies NO proration and no plan_prorated audit when the org has no provider subscription (AC-PRORATE-03)', async () => {
    // The provider is NEVER called on the no-billing-account path (regression-safe, byte-for-byte).
    const spy = vi.spyOn(ctx.payment, 'changePlan');
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'GROWTH' });
    expect(spy).not.toHaveBeenCalled();
    expect(v.prorationCents).toBe(0);
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.plan_prorated')).toBe(false);
    // No proration invoice was recorded — the row path is unchanged.
    expect(await ctx.invoices.listForOrg(orgId)).toEqual([]);
  });

  it('previewPlanChange returns the same amount a change would apply, without mutating (AC-PRORATE-04)', async () => {
    await provisionGrowth();
    const before = JSON.stringify(await ctx.invoices.listForOrg(orgId));
    const planBefore = (await ctx.subscriptions.findByOrg(orgId))!.plan;

    const preview = await new PreviewPlanChange(ctx).execute({ userId, orgId, plan: 'SCALE' });
    expect(preview).toMatchObject({ plan: 'SCALE', prorationCents: 40000 });

    // Read-only: neither the invoices nor the subscription changed.
    expect(JSON.stringify(await ctx.invoices.listForOrg(orgId))).toBe(before);
    expect((await ctx.subscriptions.findByOrg(orgId))!.plan).toBe(planBefore);
  });

  it('previewPlanChange is 0 without a provider subscription and enforces RBAC + tenant isolation', async () => {
    expect((await new PreviewPlanChange(ctx).execute({ userId, orgId, plan: 'GROWTH' })).prorationCents).toBe(0);

    const member = (
      await new RegisterUser(ctx).execute({ firstName: 'M', lastName: 'R', email: 'prev-m@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: member, role: 'MEMBER', createdAt: ctx.clock.now() });
    await expect(new PreviewPlanChange(ctx).execute({ userId: member, orgId, plan: 'GROWTH' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'prev-eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new PreviewPlanChange(ctx).execute({ userId: outsider, orgId, plan: 'GROWTH' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('cancels with an opt-in prorated refund, records a credit, and audits it (AC-PRORATE-05)', async () => {
    await provisionGrowth();
    ctx.clock.advance(15 * 24 * 60 * 60 * 1000); // half the 30-day period remaining → fraction 0.5

    const v = await new CancelSubscription(ctx).execute({ userId, orgId, refund: true });
    expect(v.status).toBe('CANCELED');
    expect(v.refundedCents).toBe(4950); // round(9900 × 0.5)
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.refunded' && r.metadata.refundedCents === 4950)).toBe(true);
    const credit = (await ctx.invoices.listForOrg(orgId)).find((i) => i.providerInvoiceId === `in_mock_refund_${orgId}`);
    expect(credit).toMatchObject({ status: 'VOID', amountCents: -4950 });
  });

  it('cancels without a refund by default — no refund, no refunded audit (AC-PRORATE-06)', async () => {
    await provisionGrowth();
    const invoicesBefore = (await ctx.invoices.listForOrg(orgId)).length;
    // The provider refund path is NEVER touched on the default (no-flag) cancel — byte-for-byte.
    const spy = vi.spyOn(ctx.payment, 'refund');

    const v = await new CancelSubscription(ctx).execute({ userId, orgId });
    expect(spy).not.toHaveBeenCalled();
    expect(v.status).toBe('CANCELED');
    expect(v.refundedCents).toBeUndefined();
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.refunded')).toBe(false);
    // No credit invoice recorded.
    expect((await ctx.invoices.listForOrg(orgId)).length).toBe(invoicesBefore);
  });

  // ---- Slice 34: Stripe billing portal (portal-only) ----

  it('opens the portal for an admin once a checkout established a customer, and audits it (AC-PORTAL-01)', async () => {
    // A fresh org has no provider customer yet → the portal is blocked (AC-PORTAL-04).
    await expect(new StartBillingPortal(ctx).execute({ userId, orgId })).rejects.toMatchObject({ code: 'VALIDATION' });

    // Complete a mock checkout: confirm mints cus_mock_<orgId> on the subscription.
    await new StartCheckout(ctx).execute({ userId, orgId });
    await new ConfirmCheckout(ctx).execute({ userId, orgId });

    const { portalUrl } = await new StartBillingPortal(ctx).execute({ userId, orgId });
    expect(portalUrl).toBe(`https://mock.pay/portal/${orgId}`);
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.portal_opened')).toBe(true);
  });

  it('an ADMIN (not only the OWNER) can open the portal', async () => {
    await new StartCheckout(ctx).execute({ userId, orgId });
    await new ConfirmCheckout(ctx).execute({ userId, orgId });
    const admin = (
      await new RegisterUser(ctx).execute({ firstName: 'A', lastName: 'D', email: 'padmin@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: admin, role: 'ADMIN', createdAt: ctx.clock.now() });
    const { portalUrl } = await new StartBillingPortal(ctx).execute({ userId: admin, orgId });
    expect(portalUrl).toBe(`https://mock.pay/portal/${orgId}`);
  });

  it('enforces RBAC + tenant isolation on the portal (AC-PORTAL-02/03)', async () => {
    // Establish a customer so the RBAC checks are what fails, not the no-customer precondition.
    await new StartCheckout(ctx).execute({ userId, orgId });
    await new ConfirmCheckout(ctx).execute({ userId, orgId });

    const member = (
      await new RegisterUser(ctx).execute({ firstName: 'M', lastName: 'R', email: 'pm@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: member, role: 'MEMBER', createdAt: ctx.clock.now() });
    await expect(new StartBillingPortal(ctx).execute({ userId: member, orgId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'peve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new StartBillingPortal(ctx).execute({ userId: outsider, orgId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('does not audit or call the provider when there is no billing account (AC-PORTAL-04)', async () => {
    await expect(new StartBillingPortal(ctx).execute({ userId, orgId })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(ctx.audit.rows.some((r) => r.action === 'subscription.portal_opened')).toBe(false);
  });

  it('discounts the annual cycle (AC-SUB-08)', async () => {
    const m = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER', billingCycle: 'MONTHLY' });
    const a = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER', billingCycle: 'ANNUAL' });
    expect(a.priceCents).toBeLessThan(m.priceCents);
  });

  it('exposes the workspace-aware computed Scale price on the view (AC-B4T-03)', async () => {
    const base = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'SCALE' });
    expect(base.priceCents).toBe(49900);
    expect((await new UpdateSeats(ctx).execute({ userId, orgId, seats: 10 })).priceCents).toBe(49900);
    expect((await new UpdateSeats(ctx).execute({ userId, orgId, seats: 12 })).priceCents).toBe(69700); // + 2 × $99
  });

  it('computes the annual price as 10 charged months (AC-B4T-04)', async () => {
    const growth = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'GROWTH', billingCycle: 'ANNUAL' });
    expect(growth.priceCents).toBe(8250); // round(9900 × 10 / 12)
    const starter = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'STARTER', billingCycle: 'ANNUAL' });
    expect(starter.priceCents).toBe(2417); // round(2900 × 10 / 12)
  });

  it('enforces RBAC + tenant isolation (AC-SUB-02/09)', async () => {
    const member = (
      await new RegisterUser(ctx).execute({ firstName: 'M', lastName: 'R', email: 'm@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: member, role: 'MEMBER', createdAt: ctx.clock.now() });
    expect((await new GetOrgSubscription(ctx).execute({ userId: member, orgId })).plan).toBe('FREE');
    await expect(new ChangeSubscription(ctx).execute({ userId: member, orgId, plan: 'STARTER' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetOrgSubscription(ctx).execute({ userId: outsider, orgId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(new ChangeSubscription(ctx).execute({ userId: outsider, orgId, plan: 'STARTER' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
