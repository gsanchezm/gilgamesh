import type { SubscriptionRepository } from '../ports/repositories';

export interface ResetBillingUsageDeps {
  subscriptions: SubscriptionRepository;
}

/**
 * Billing-period usage rollover (slice 21, closes owner note S14-6). Resets an org's — or every
 * org's — two `Subscription` usage counters (`runMinutesUsed` + `brainTokensUsed`) to zero TOGETHER
 * so the next period's quota gates start from a clean tally.
 *
 * It delegates to the single atomic `SubscriptionRepository.resetUsage` and does no other write, so
 * (unlike `BrainBilling.charge`) it needs no `UnitOfWork` wrapper — the same shape as the direct
 * atomic `chargeRunMinutes`/`chargeBrainTokens` methods. Operator-triggered (the `rollover:billing`
 * script), never an HTTP surface; there is no RBAC gate here because there is no request actor.
 */
export class ResetBillingUsage {
  constructor(private readonly deps: ResetBillingUsageDeps) {}

  /** `orgId` omitted → reset every subscription. Returns how many rows were reset. */
  async execute(input: { orgId?: string } = {}): Promise<{ reset: number }> {
    const reset = await this.deps.subscriptions.resetUsage(input.orgId);
    return { reset };
  }
}
