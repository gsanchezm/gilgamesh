import {
  type AgentBrainPort,
  type AgentRepository,
  type AuditLogRepository,
  type BrainTokenMeter,
  type Clock,
  CreateFeature,
  CreateSlice,
  CreateTestCase,
  DeleteFeature,
  DeleteSlice,
  DeleteTestCase,
  type FeatureRepository,
  GenerateDrafts,
  GetFeature,
  GetTestCase,
  type IdGenerator,
  type KnowledgeRetrievalPort,
  ListFeatures,
  ListSlices,
  ListTestCases,
  type MembershipRepository,
  type ProjectRepository,
  type ScenarioRepository,
  type SliceRepository,
  type TestCaseRepository,
  type UnitOfWork,
  UpdateFeature,
  UpdateSlice,
  UpdateTestCase,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { FeatureController, ProjectFeaturesController } from './features.controller';
import { ProjectSlicesController, SliceController } from './slices.controller';
import { ProjectTestCasesController, TestCaseController } from './testcases.controller';

const T = TOKENS;

const providers: Provider[] = [
  // Slices
  {
    provide: CreateSlice,
    useFactory: (
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new CreateSlice({ slices, projects, memberships, audit, ids, clock }),
    inject: [T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: ListSlices,
    useFactory: (slices: SliceRepository, projects: ProjectRepository, memberships: MembershipRepository) =>
      new ListSlices({ slices, projects, memberships }),
    inject: [T.Slices, T.Projects, T.Memberships],
  },
  {
    provide: UpdateSlice,
    useFactory: (
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new UpdateSlice({ slices, projects, memberships, audit, ids, clock }),
    inject: [T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: DeleteSlice,
    useFactory: (
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
      features: FeatureRepository,
      testCases: TestCaseRepository,
    ) => new DeleteSlice({ slices, projects, memberships, audit, ids, clock, features, testCases }),
    inject: [T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock, T.Features, T.TestCases],
  },
  // Features
  {
    provide: CreateFeature,
    useFactory: (
      uow: UnitOfWork,
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new CreateFeature({ uow, features, scenarios, slices, projects, memberships, audit, ids, clock }),
    inject: [T.UnitOfWork, T.Features, T.Scenarios, T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: ListFeatures,
    useFactory: (
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
    ) => new ListFeatures({ features, scenarios, projects, memberships }),
    inject: [T.Features, T.Scenarios, T.Projects, T.Memberships],
  },
  {
    provide: GetFeature,
    useFactory: (
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
    ) => new GetFeature({ features, scenarios, projects, memberships }),
    inject: [T.Features, T.Scenarios, T.Projects, T.Memberships],
  },
  {
    provide: UpdateFeature,
    useFactory: (
      uow: UnitOfWork,
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new UpdateFeature({ uow, features, scenarios, slices, projects, memberships, audit, ids, clock }),
    inject: [T.UnitOfWork, T.Features, T.Scenarios, T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: DeleteFeature,
    useFactory: (
      uow: UnitOfWork,
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      slices: SliceRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new DeleteFeature({ uow, features, scenarios, slices, projects, memberships, audit, ids, clock }),
    inject: [T.UnitOfWork, T.Features, T.Scenarios, T.Slices, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  // Test cases
  {
    provide: CreateTestCase,
    useFactory: (
      testCases: TestCaseRepository,
      slices: SliceRepository,
      agents: AgentRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new CreateTestCase({ testCases, slices, agents, projects, memberships, audit, ids, clock }),
    inject: [T.TestCases, T.Slices, T.Agents, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: ListTestCases,
    useFactory: (
      testCases: TestCaseRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
    ) => new ListTestCases({ testCases, projects, memberships }),
    inject: [T.TestCases, T.Projects, T.Memberships],
  },
  {
    provide: GetTestCase,
    useFactory: (
      testCases: TestCaseRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
    ) => new GetTestCase({ testCases, projects, memberships }),
    inject: [T.TestCases, T.Projects, T.Memberships],
  },
  {
    provide: UpdateTestCase,
    useFactory: (
      testCases: TestCaseRepository,
      slices: SliceRepository,
      agents: AgentRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new UpdateTestCase({ testCases, slices, agents, projects, memberships, audit, ids, clock }),
    inject: [T.TestCases, T.Slices, T.Agents, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  {
    provide: DeleteTestCase,
    useFactory: (
      testCases: TestCaseRepository,
      slices: SliceRepository,
      agents: AgentRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new DeleteTestCase({ testCases, slices, agents, projects, memberships, audit, ids, clock }),
    inject: [T.TestCases, T.Slices, T.Agents, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
  // Generate
  {
    provide: GenerateDrafts,
    useFactory: (
      brain: AgentBrainPort,
      retrieval: KnowledgeRetrievalPort,
      billing: BrainTokenMeter,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new GenerateDrafts({ brain, retrieval, billing, projects, memberships, audit, ids, clock }),
    inject: [T.Brain, T.KnowledgeRetrieval, T.BrainBilling, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
];

@Module({
  controllers: [
    ProjectSlicesController,
    SliceController,
    ProjectFeaturesController,
    FeatureController,
    ProjectTestCasesController,
    TestCaseController,
  ],
  providers,
  // Consumed by the chat tool whitelist (slice 8) — one canonical wiring for both entry points.
  exports: [CreateTestCase, GenerateDrafts],
})
export class TestLabModule {}
