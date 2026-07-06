import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GetOrgSubscription } from './org-queries';
import { RegisterUser } from './register-user';
import {
  CancelSubscription,
  ChangeSubscription,
  ConfirmCheckout,
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
    });
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
