import type { KnowledgeChunkRepository, KnowledgeDocumentRepository } from './knowledge';
import type {
  AgentRepository,
  AuditLogRepository,
  FeatureRepository,
  MembershipRepository,
  OrgRepository,
  ProjectRepository,
  RunRepository,
  RunResultRepository,
  ScenarioRepository,
  SessionRepository,
  SliceRepository,
  SubscriptionRepository,
  TestCaseRepository,
  ToolBindingRepository,
  UserRepository,
} from './repositories';

/**
 * The full set of repository ports, handed to a UnitOfWork callback bound to a single
 * transaction. Multi-write use cases take only the repos they need from this bundle.
 */
export interface Repositories {
  users: UserRepository;
  orgs: OrgRepository;
  memberships: MembershipRepository;
  sessions: SessionRepository;
  projects: ProjectRepository;
  slices: SliceRepository;
  features: FeatureRepository;
  scenarios: ScenarioRepository;
  testCases: TestCaseRepository;
  runs: RunRepository;
  runResults: RunResultRepository;
  agents: AgentRepository;
  toolBindings: ToolBindingRepository;
  subscriptions: SubscriptionRepository;
  audit: AuditLogRepository;
  knowledge: KnowledgeChunkRepository;
  knowledgeDocuments: KnowledgeDocumentRepository;
}

/**
 * Atomic boundary for multi-write flows. Every repository write performed via the `repos`
 * handed to `work` commits together or rolls back together if `work` throws. The application
 * layer depends only on this port; the Prisma adapter implements it with an interactive
 * transaction, the in-memory adapter runs the work against its shared stores.
 */
export interface UnitOfWork {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
