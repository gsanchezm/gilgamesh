import {
  type AgentBrainPort,
  type AgentRepository,
  type AuditLogRepository,
  type ChatMessageRepository,
  type ChatSessionRepository,
  type Clock,
  CreateChatSession,
  CreateTestCase,
  type FeatureRepository,
  GenerateDrafts,
  GetChatEvents,
  type IdGenerator,
  type KnowledgeRetrievalPort,
  type MembershipRepository,
  type ProjectRepository,
  SendChatMessage,
  type ToolBindingRepository,
  TriggerRun,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { RunsModule } from '../runs/runs.module';
import { TestLabModule } from '../testlab/testlab.module';
import { ChatController, ProjectChatController } from './chat.controller';

/**
 * Wires the Agent Chat use cases (slice 8) to the bound ports. The tool whitelist injects the
 * CANONICAL use-case instances exported by RunsModule/TestLabModule — a chat-invoked action follows
 * exactly the standard path (RBAC, quota, audit) and can never drift from it (review S8).
 */
@Module({
  imports: [RunsModule, TestLabModule],
  controllers: [ProjectChatController, ChatController],
  providers: [
    {
      provide: CreateChatSession,
      useFactory: (
        chatSessions: ChatSessionRepository,
        agents: AgentRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new CreateChatSession({ chatSessions, agents, projects, memberships, audit, ids, clock }),
      inject: [T.ChatSessions, T.Agents, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
    },
    {
      provide: SendChatMessage,
      useFactory: (
        chatSessions: ChatSessionRepository,
        chatMessages: ChatMessageRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
        agents: AgentRepository,
        toolBindings: ToolBindingRepository,
        features: FeatureRepository,
        brain: AgentBrainPort,
        retrieval: KnowledgeRetrievalPort,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
        triggerRun: TriggerRun,
        createTestCase: CreateTestCase,
        generateDrafts: GenerateDrafts,
      ) =>
        new SendChatMessage({
          chatSessions,
          chatMessages,
          projects,
          memberships,
          agents,
          toolBindings,
          features,
          brain,
          retrieval,
          audit,
          ids,
          clock,
          tools: { triggerRun, createTestCase, generateDrafts },
        }),
      inject: [
        T.ChatSessions,
        T.ChatMessages,
        T.Projects,
        T.Memberships,
        T.Agents,
        T.ToolBindings,
        T.Features,
        T.Brain,
        T.KnowledgeRetrieval,
        T.Audit,
        T.Ids,
        T.Clock,
        TriggerRun,
        CreateTestCase,
        GenerateDrafts,
      ],
    },
    {
      provide: GetChatEvents,
      useFactory: (
        chatSessions: ChatSessionRepository,
        chatMessages: ChatMessageRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
      ) => new GetChatEvents({ chatSessions, chatMessages, projects, memberships }),
      inject: [T.ChatSessions, T.ChatMessages, T.Projects, T.Memberships],
    },
  ],
})
export class ChatModule {}
