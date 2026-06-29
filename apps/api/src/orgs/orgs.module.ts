import {
  type AgentRepository,
  GetOrgSubscription,
  ListOrgAgents,
  type MembershipRepository,
  type SubscriptionRepository,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { OrgsController } from './orgs.controller';

@Module({
  controllers: [OrgsController],
  providers: [
    {
      provide: ListOrgAgents,
      useFactory: (agents: AgentRepository, memberships: MembershipRepository) =>
        new ListOrgAgents({ agents, memberships }),
      inject: [TOKENS.Agents, TOKENS.Memberships],
    },
    {
      provide: GetOrgSubscription,
      useFactory: (subscriptions: SubscriptionRepository, memberships: MembershipRepository) =>
        new GetOrgSubscription({ subscriptions, memberships }),
      inject: [TOKENS.Subscriptions, TOKENS.Memberships],
    },
  ],
})
export class OrgsModule {}
