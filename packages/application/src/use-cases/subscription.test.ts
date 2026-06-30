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
    expect(v).toMatchObject({ plan: 'TEAM', status: 'TRIALING', maxSeats: 5, unlimited: false, runMinutesQuota: 1000 });
  });

  it('changes the plan and remaps quota + seat cap (AC-SUB-02)', async () => {
    const v = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'PRO' });
    expect(v).toMatchObject({ plan: 'PRO', runMinutesQuota: 10000, maxSeats: 11 });
  });

  it('updates seats within the plan cap, rejects over it (AC-SUB-04)', async () => {
    expect((await new UpdateSeats(ctx).execute({ userId, orgId, seats: 4 })).seats).toBe(4);
    await expect(new UpdateSeats(ctx).execute({ userId, orgId, seats: 6 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a plan change whose seat cap is below current seats (AC-SUB-03)', async () => {
    await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'PRO' });
    await new UpdateSeats(ctx).execute({ userId, orgId, seats: 8 });
    await expect(new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'TEAM' })).rejects.toMatchObject({
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

  it('rejects a self-service upgrade to ENTERPRISE (contact sales)', async () => {
    await expect(new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'ENTERPRISE' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('cancels the subscription (AC-SUB-06)', async () => {
    expect((await new CancelSubscription(ctx).execute({ userId, orgId })).status).toBe('CANCELED');
  });

  it('discounts the annual cycle (AC-SUB-08)', async () => {
    const m = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'PRO', billingCycle: 'MONTHLY' });
    const a = await new ChangeSubscription(ctx).execute({ userId, orgId, plan: 'PRO', billingCycle: 'ANNUAL' });
    expect(a.priceCents).toBeLessThan(m.priceCents);
  });

  it('enforces RBAC + tenant isolation (AC-SUB-02/09)', async () => {
    const member = (
      await new RegisterUser(ctx).execute({ firstName: 'M', lastName: 'R', email: 'm@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: member, role: 'MEMBER', createdAt: ctx.clock.now() });
    expect((await new GetOrgSubscription(ctx).execute({ userId: member, orgId })).plan).toBe('TEAM');
    await expect(new ChangeSubscription(ctx).execute({ userId: member, orgId, plan: 'PRO' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetOrgSubscription(ctx).execute({ userId: outsider, orgId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(new ChangeSubscription(ctx).execute({ userId: outsider, orgId, plan: 'PRO' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
