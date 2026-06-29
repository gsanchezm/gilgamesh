import {
  type AgentRepository,
  type AuditLogRepository,
  type Clock,
  CompleteOnboarding,
  type IdGenerator,
  type MembershipRepository,
  type OrgRepository,
  type ProjectRepository,
  type SliceRepository,
  type SubscriptionRepository,
  type ToolBindingRepository,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { ProjectsController } from './projects.controller';

@Module({
  controllers: [ProjectsController],
  providers: [
    {
      provide: CompleteOnboarding,
      useFactory: (
        orgs: OrgRepository,
        memberships: MembershipRepository,
        projects: ProjectRepository,
        slices: SliceRepository,
        agents: AgentRepository,
        toolBindings: ToolBindingRepository,
        subscriptions: SubscriptionRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) =>
        new CompleteOnboarding({
          orgs,
          memberships,
          projects,
          slices,
          agents,
          toolBindings,
          subscriptions,
          audit,
          ids,
          clock,
        }),
      inject: [
        TOKENS.Orgs,
        TOKENS.Memberships,
        TOKENS.Projects,
        TOKENS.Slices,
        TOKENS.Agents,
        TOKENS.ToolBindings,
        TOKENS.Subscriptions,
        TOKENS.Audit,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
  ],
})
export class ProjectsModule {}
