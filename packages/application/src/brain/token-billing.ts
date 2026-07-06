import { planLimits } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { BrainSurface, BrainTier } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { SubscriptionRepository } from '../ports/repositories';
import type { UnitOfWork } from '../ports/unit-of-work';

/** The token counts a brain call reports (cache fields are the additive S9 extension). */
export interface BrainCallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

/**
 * Billable tokens per owner decision S14 (keystone §2 BrainUsage note): input + output ONLY —
 * cache read/create tokens are EXCLUDED, so prompt caching never penalizes the customer.
 * The single definition; every surface charges through it.
 */
export function billableTokens(usage: BrainCallUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * The check/charge seam every org-attributed brain surface consumes (slice 14). An interface —
 * not the class — so tests can double it (the `BrainKeyVerifier`/`EmbedMeter` precedent).
 */
export interface BrainTokenMeter {
  /** True when the org's plan meters tokens and the counter has reached the quota. */
  isExhausted(orgId: string): Promise<boolean>;
  /** Pre-call gate for API surfaces: throws `QUOTA_EXCEEDED` (→ 402) when exhausted. */
  assertWithinQuota(orgId: string): Promise<void>;
  /**
   * Records the `BrainUsage` row AND charges the billable tokens against
   * `Subscription.brainTokensUsed` in ONE UnitOfWork transaction (keystone §2: "charge …
   * atomically per call") — the usage rows and the counter can never diverge.
   */
  charge(orgId: string, surface: BrainSurface, tier: BrainTier, usage: BrainCallUsage): Promise<void>;
}

export const TOKEN_QUOTA_MESSAGE =
  'AI token allowance exhausted for this billing period. Upgrade your plan for more AI tokens.';

export interface BrainBillingDeps {
  uow: UnitOfWork;
  subscriptions: SubscriptionRepository;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Per-plan AI-token quota + atomic charging (slice 14, keystone v0.6). Enforcement is
 * check-BEFORE / charge-AFTER (owner decision S14-5, the slice-4 TriggerRun pattern):
 *
 * - The pre-check (`isExhausted`/`assertWithinQuota`) runs before any billable brain call:
 *   `brainTokensUsed >= brainTokensQuota` on a metered plan blocks. No subscription row →
 *   no metering, never blocked (the `chargeRunMinutes` precedent). SCALE
 *   (`brainTokensUnlimited`) never blocks — but keeps being metered and charged.
 * - The post-call `charge` is UNCONDITIONAL (deviation from the conditional
 *   `chargeRunMinutes`, spec 14 §5.2): a brain call's cost is known only after the tokens
 *   are consumed, so refusing would un-record real usage. Overshoot is bounded by one call
 *   past the quota, recorded truthfully, and the NEXT call's pre-check blocks.
 */
export class BrainBilling implements BrainTokenMeter {
  constructor(private readonly deps: BrainBillingDeps) {}

  async isExhausted(orgId: string): Promise<boolean> {
    const sub = await this.deps.subscriptions.findByOrg(orgId);
    if (!sub) return false;
    if (planLimits(sub.plan).brainTokensUnlimited) return false;
    return sub.brainTokensUsed >= sub.brainTokensQuota;
  }

  async assertWithinQuota(orgId: string): Promise<void> {
    if (await this.isExhausted(orgId)) {
      throw new ApplicationError('QUOTA_EXCEEDED', TOKEN_QUOTA_MESSAGE);
    }
  }

  async charge(orgId: string, surface: BrainSurface, tier: BrainTier, usage: BrainCallUsage): Promise<void> {
    const row = {
      id: this.deps.ids.next(),
      orgId,
      tier,
      surface,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreateTokens: usage.cacheCreateTokens ?? 0,
      createdAt: this.deps.clock.now(),
    };
    const tokens = billableTokens(usage);
    await this.deps.uow.transaction(async (repos) => {
      await repos.brainUsage.append(row);
      await repos.subscriptions.chargeBrainTokens(orgId, tokens);
    });
  }
}
