import { AGENT_ROSTER, type AgentFamily, type AgentSlot } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type {
  AgentRepository,
  MembershipRepository,
  SubscriptionRepository,
} from '../ports/repositories';
import { type SubscriptionView, subscriptionView } from './subscription';

export type { SubscriptionView };

export interface OrgAgentView {
  slot: AgentSlot;
  deityName: string;
  role: string;
  family: AgentFamily;
  glyph: string;
  culture: string;
  defaultTool: string;
  toolOptions: string[];
}

async function requireOrgMember(
  memberships: MembershipRepository,
  userId: string,
  orgId: string,
): Promise<void> {
  const role = await memberships.findRole(orgId, userId);
  if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
}

/** The per-Org agent catalog (the canonical 11), in roster order. */
export class ListOrgAgents {
  constructor(private readonly deps: { agents: AgentRepository; memberships: MembershipRepository }) {}

  async execute(input: { userId: string; orgId: string }): Promise<OrgAgentView[]> {
    await requireOrgMember(this.deps.memberships, input.userId, input.orgId);
    const agents = await this.deps.agents.listForOrg(input.orgId);
    return AGENT_ROSTER.flatMap((entry) => {
      const a = agents.find((x) => x.slot === entry.slot);
      return a
        ? [
            {
              slot: a.slot,
              deityName: a.deityName,
              role: a.role,
              family: a.family,
              glyph: a.glyph,
              culture: a.culture,
              defaultTool: a.defaultTool,
              toolOptions: [...entry.toolOptions],
            },
          ]
        : [];
    });
  }
}

export class GetOrgSubscription {
  constructor(
    private readonly deps: { subscriptions: SubscriptionRepository; memberships: MembershipRepository },
  ) {}

  async execute(input: { userId: string; orgId: string }): Promise<SubscriptionView> {
    await requireOrgMember(this.deps.memberships, input.userId, input.orgId);
    const sub = await this.deps.subscriptions.findByOrg(input.orgId);
    if (!sub) throw new ApplicationError('NOT_FOUND', 'Subscription not found.');
    return subscriptionView(sub);
  }
}
