import { aggregateBrainUsage, type BrainUsageAggregate } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { BrainUsageRepository, MembershipRepository } from '../ports/repositories';

export type BrainUsageView = BrainUsageAggregate;

interface UsageDeps {
  brainUsage: BrainUsageRepository;
  memberships: MembershipRepository;
}

/** Per-org token usage view (keystone v0.3): any member (incl. VIEWER) reads; non-member → NOT_FOUND. */
export class GetBrainUsage {
  constructor(private readonly deps: UsageDeps) {}

  async execute(input: { userId: string; orgId: string }): Promise<BrainUsageView> {
    const role = await this.deps.memberships.findRole(input.orgId, input.userId);
    if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
    const rows = await this.deps.brainUsage.listForOrg(input.orgId);
    return aggregateBrainUsage(rows);
  }
}
