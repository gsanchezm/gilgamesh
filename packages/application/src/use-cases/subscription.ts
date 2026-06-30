import { planLimits, priceCents } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { PaymentProvider } from '../ports/payment';
import type { BillingCycle, Plan, Role, SubscriptionRecord, SubscriptionStatus } from '../ports/records';
import type { AuditLogRepository, MembershipRepository, SubscriptionRepository } from '../ports/repositories';

const ADMINS: Role[] = ['OWNER', 'ADMIN'];

export interface SubscriptionView {
  plan: Plan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  seats: number;
  maxSeats: number;
  unlimited: boolean;
  runMinutesQuota: number;
  runMinutesUsed: number;
  priceCents: number;
  providerCustomerId: string | null;
  currentPeriodEnd: Date | null;
}

export function subscriptionView(sub: SubscriptionRecord): SubscriptionView {
  const limits = planLimits(sub.plan);
  return {
    plan: sub.plan,
    status: sub.status,
    billingCycle: sub.billingCycle,
    seats: sub.seats,
    maxSeats: limits.maxSeats,
    unlimited: limits.unlimited,
    runMinutesQuota: sub.runMinutesQuota,
    runMinutesUsed: sub.runMinutesUsed,
    priceCents: priceCents(sub.plan, sub.billingCycle),
    providerCustomerId: sub.providerCustomerId,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}

interface SubDeps {
  subscriptions: SubscriptionRepository;
  memberships: MembershipRepository;
  payment: PaymentProvider;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

/** OWNER/ADMIN gate. A non-member gets NOT_FOUND (existence not leaked); a member without the role 403. */
async function requireOrgAdmin(deps: SubDeps, userId: string, orgId: string): Promise<void> {
  const role = await deps.memberships.findRole(orgId, userId);
  if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
  if (!ADMINS.includes(role)) throw new ApplicationError('FORBIDDEN', 'Owners and admins only.');
}

async function requireSub(deps: SubDeps, orgId: string): Promise<SubscriptionRecord> {
  const sub = await deps.subscriptions.findByOrg(orgId);
  if (!sub) throw new ApplicationError('NOT_FOUND', 'Subscription not found.');
  return sub;
}

function audit(deps: SubDeps, orgId: string, userId: string, action: string, metadata: Record<string, unknown>) {
  return deps.audit.append({
    id: deps.ids.next(),
    orgId,
    actorUserId: userId,
    action,
    targetType: 'Subscription',
    targetId: orgId,
    metadata,
    ip: null,
    createdAt: deps.clock.now(),
  });
}

export class ChangeSubscription {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: {
    userId: string;
    orgId: string;
    plan: Plan;
    billingCycle?: BillingCycle;
  }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const limits = planLimits(input.plan);
    if (sub.seats > limits.maxSeats) {
      throw new ApplicationError('VALIDATION', 'Current seats exceed the new plan limit; reduce seats first.');
    }
    const updated: SubscriptionRecord = {
      ...sub,
      plan: input.plan,
      billingCycle: input.billingCycle ?? sub.billingCycle,
      runMinutesQuota: limits.runMinutesQuota,
    };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.plan_changed', {
      plan: input.plan,
      billingCycle: updated.billingCycle,
    });
    return subscriptionView(updated);
  }
}

export class UpdateSeats {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string; seats: number }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const limits = planLimits(sub.plan);
    if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > limits.maxSeats) {
      throw new ApplicationError('VALIDATION', `Seats must be between 1 and ${limits.maxSeats}.`);
    }
    const updated: SubscriptionRecord = { ...sub, seats: input.seats };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.seats_changed', { seats: input.seats });
    return subscriptionView(updated);
  }
}

export class StartCheckout {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string }): Promise<{ checkoutUrl: string }> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    return this.deps.payment.createCheckout({
      orgId: input.orgId,
      plan: sub.plan,
      cycle: sub.billingCycle,
      seats: sub.seats,
    });
  }
}

export class ConfirmCheckout {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const ids = await this.deps.payment.confirmCheckout(input.orgId);
    const now = this.deps.clock.now();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const updated: SubscriptionRecord = {
      ...sub,
      status: 'ACTIVE',
      providerCustomerId: ids.providerCustomerId,
      providerSubscriptionId: ids.providerSubscriptionId,
      currentPeriodEnd: periodEnd,
    };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.activated', { plan: sub.plan });
    return subscriptionView(updated);
  }
}

export class CancelSubscription {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const updated: SubscriptionRecord = { ...sub, status: 'CANCELED' };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.canceled', {});
    return subscriptionView(updated);
  }
}
