import {
  type AgentRepository,
  type AuditLogRepository,
  type Clock,
  GetAgentRoom,
  type IdGenerator,
  type MembershipRepository,
  type ProjectRepository,
  SetAgentToolBinding,
  type ToolBindingRepository,
  WakeAllAgents,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { AgentsController } from './agents.controller';

@Module({
  controllers: [AgentsController],
  providers: [
    {
      provide: GetAgentRoom,
      useFactory: (
        projects: ProjectRepository,
        agents: AgentRepository,
        toolBindings: ToolBindingRepository,
        memberships: MembershipRepository,
      ) => new GetAgentRoom({ projects, agents, toolBindings, memberships }),
      inject: [TOKENS.Projects, TOKENS.Agents, TOKENS.ToolBindings, TOKENS.Memberships],
    },
    {
      provide: SetAgentToolBinding,
      useFactory: (
        projects: ProjectRepository,
        agents: AgentRepository,
        toolBindings: ToolBindingRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new SetAgentToolBinding({ projects, agents, toolBindings, memberships, audit, ids, clock }),
      inject: [
        TOKENS.Projects,
        TOKENS.Agents,
        TOKENS.ToolBindings,
        TOKENS.Memberships,
        TOKENS.Audit,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    {
      provide: WakeAllAgents,
      useFactory: (
        projects: ProjectRepository,
        toolBindings: ToolBindingRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new WakeAllAgents({ projects, toolBindings, memberships, audit, ids, clock }),
      inject: [
        TOKENS.Projects,
        TOKENS.ToolBindings,
        TOKENS.Memberships,
        TOKENS.Audit,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
  ],
})
export class AgentsModule {}
