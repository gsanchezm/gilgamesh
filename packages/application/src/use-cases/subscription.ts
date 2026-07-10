import { planLimits, priceCents } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { ChangePlanRequest, PaymentProvider } from '../ports/payment';
import type { BillingCycle, Plan, Role, SubscriptionRecord, SubscriptionStatus } from '../ports/records';
import type { AuditLogRepository, MembershipRepository, SubscriptionRepository } from '../ports/repositories';

const ADMINS: Role[] = ['OWNER', 'ADMIN'];

export interface SubscriptionView {
  plan: Plan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  /** Active workspaces. Backed by the legacy `seats` column until the storage model is renamed. */
  seats: number;
  maxSeats: number;
  maxServicesPerWorkspace: number;
  maxUsersPerWorkspace: number;
  includedWorkspaces: number;
  unlimited: boolean;
  /** Monthly executions. Backed by the legacy `runMinutes*` columns until the storage model is renamed. */
  runMinutesQuota: number;
  runMinutesUsed: number;
  /** Monthly AI Brain token allowance (slice 14, keystone §2 v0.6). */
  brainTokensQuota: number;
  brainTokensUsed: number;
  /** True on SCALE — token blocking is bypassed (metering isn't). */
  brainTokensUnlimited: boolean;
  priceCents: number;
  providerCustomerId: string | null;
  currentPeriodEnd: Date | null;
  /**
   * Slice 40 (additive, optional): the SIGNED proration applied by a plan change (positive charge /
   * negative credit). Present on a `ChangeSubscription` view; absent on reads. 0 when the org has no
   * provider subscription (never checked out).
   */
  prorationCents?: number;
  /** Slice 40 (additive, optional): the amount refunded by an opt-in cancel-with-refund. */
  refundedCents?: number;
}

/** Slice 40: the read-only proration estimate the UI shows before the user confirms a plan change. */
export interface PlanChangePreview {
  plan: Plan;
  billingCycle: BillingCycle;
  /** Signed: positive = charged now, negative = credited. 0 when there is no provider subscription. */
  prorationCents: number;
}

export function subscriptionView(sub: SubscriptionRecord): SubscriptionView {
  const limits = planLimits(sub.plan);
  return {
    plan: sub.plan,
    status: sub.status,
    billingCycle: sub.billingCycle,
    seats: sub.seats,
    maxSeats: limits.maxSeats,
    maxServicesPerWorkspace: limits.maxServicesPerWorkspace,
    maxUsersPerWorkspace: limits.maxUsersPerWorkspace,
    includedWorkspaces: limits.includedWorkspaces,
    unlimited: limits.unlimited,
    runMinutesQuota: sub.runMinutesQuota,
    runMinutesUsed: sub.runMinutesUsed,
    brainTokensQuota: sub.brainTokensQuota,
    brainTokensUsed: sub.brainTokensUsed,
    brainTokensUnlimited: limits.brainTokensUnlimited,
    priceCents: priceCents(sub.plan, sub.billingCycle, sub.seats),
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
      throw new ApplicationError('VALIDATION', 'Current active workspaces exceed the new plan limit; reduce them first.');
    }
    const billingCycle = input.billingCycle ?? sub.billingCycle;
    // S40: a plan change on an ALREADY provisioned provider subscription prorates over the remaining
    // period. Call the provider BEFORE the local save so it observes the still-current row (the mock
    // derives the old price from it) and a provider failure leaves the local state untouched. No
    // provider subscription (still FREE / never checked out) → today's pure-row path, prorationCents 0.
    let prorationCents = 0;
    if (sub.providerSubscriptionId) {
      ({ prorationCents } = await this.deps.payment.changePlan({
        orgId: input.orgId,
        plan: input.plan,
        cycle: billingCycle,
        seats: sub.seats,
      }));
    }
    const updated: SubscriptionRecord = {
      ...sub,
      plan: input.plan,
      billingCycle,
      runMinutesQuota: limits.runMinutesQuota,
      // S14: the token quota remaps from the new plan exactly like the executions quota;
      // brainTokensUsed is PRESERVED — nothing but the (deferred, shared) period rollover resets it.
      brainTokensQuota: limits.brainTokensQuota,
    };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.plan_changed', {
      plan: input.plan,
      billingCycle: updated.billingCycle,
    });
    if (sub.providerSubscriptionId) {
      await audit(this.deps, input.orgId, input.userId, 'subscription.plan_prorated', {
        plan: input.plan,
        prorationCents,
      });
    }
    return { ...subscriptionView(updated), prorationCents };
  }
}

/**
 * Slice 40: the read-only proration estimate for a prospective plan change — so the UI can show
 * "you'll be charged/credited $X" before the user confirms. OWNER/ADMIN gate; non-member NOT_FOUND.
 * Mutates nothing. 0 when the org has no provider subscription.
 */
export class PreviewPlanChange {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: {
    userId: string;
    orgId: string;
    plan: Plan;
    billingCycle?: BillingCycle;
  }): Promise<PlanChangePreview> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const billingCycle = input.billingCycle ?? sub.billingCycle;
    if (!sub.providerSubscriptionId) return { plan: input.plan, billingCycle, prorationCents: 0 };
    const { prorationCents } = await this.deps.payment.previewProration({
      orgId: input.orgId,
      plan: input.plan,
      cycle: billingCycle,
      seats: sub.seats,
    });
    return { plan: input.plan, billingCycle, prorationCents };
  }
}

export class UpdateSeats {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string; seats: number }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const limits = planLimits(sub.plan);
    if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > limits.maxSeats) {
      throw new ApplicationError('VALIDATION', `Active workspaces must be between 1 and ${limits.maxSeats}.`);
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

export class StartBillingPortal {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string }): Promise<{ portalUrl: string }> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    // S34-D: an org that never completed a checkout has no provider customer — reject with
    // VALIDATION (the confirmCheckout precedent), never call the provider or 500.
    if (!sub.providerCustomerId) {
      throw new ApplicationError('VALIDATION', 'No billing account yet — complete a checkout first.');
    }
    await audit(this.deps, input.orgId, input.userId, 'subscription.portal_opened', {});
    return this.deps.payment.createPortalSession(input.orgId);
  }
}

export class ConfirmCheckout {
  constructor(private readonly deps: SubDeps) {}
  async execute(input: { userId: string; orgId: string }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    const ids = await this.deps.payment.confirmCheckout(input.orgId);
    const now = this.deps.clock.now();
    const days = sub.billingCycle === 'ANNUAL' ? 365 : 30;
    const periodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
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
  async execute(input: { userId: string; orgId: string; refund?: boolean }): Promise<SubscriptionView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const sub = await requireSub(this.deps, input.orgId);
    // S40 (owner decision B-2): an OPT-IN prorated refund of the unused period, BEFORE the status
    // flips. The provider refunds only when there is a paid invoice; a 0 result records/audits
    // nothing. Default (refund omitted/false) is byte-for-byte the pre-slice-40 cancel.
    let refundedCents: number | undefined;
    if (input.refund) {
      const { refundedCents: refunded } = await this.deps.payment.refund({
        orgId: input.orgId,
        reason: 'cancellation',
      });
      if (refunded > 0) refundedCents = refunded;
    }
    const updated: SubscriptionRecord = { ...sub, status: 'CANCELED' };
    await this.deps.subscriptions.save(updated);
    await audit(this.deps, input.orgId, input.userId, 'subscription.canceled', {});
    if (refundedCents !== undefined) {
      await audit(this.deps, input.orgId, input.userId, 'subscription.refunded', { refundedCents });
    }
    const view = subscriptionView(updated);
    return refundedCents !== undefined ? { ...view, refundedCents } : view;
  }
}
