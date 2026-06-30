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
} from '../ports/repositories';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work';
import type {
  AgentRecord,
  AuditLogRecord,
  FeatureRecord,
  MembershipRecord,
  OrgRecord,
  ProjectRecord,
  Role,
  RunRecord,
  RunResultRecord,
  ScenarioRecord,
  SessionRecord,
  SliceRecord,
  SubscriptionRecord,
  TestCaseRecord,
  TestCaseStatus,
  ToolBindingRecord,
  UserRecord,
} from '../ports/records';
import { DeterministicBrain } from '../brain/stub-brain';
import { DeterministicKernel } from '../kernel/deterministic-kernel';
import { MockPaymentProvider } from '../payment/mock-payment-provider';
import { FakeClock, FakePasswordHasher, FakeTokenGenerator, SeqIdGenerator } from './fakes';

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  async findByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.byId.values()) if (u.email === email) return u;
    return null;
  }
  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async create(rec: UserRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
}

export class InMemoryOrgRepository implements OrgRepository {
  private readonly byId = new Map<string, OrgRecord>();
  async findBySlug(slug: string): Promise<OrgRecord | null> {
    for (const o of this.byId.values()) if (o.slug === slug) return o;
    return null;
  }
  async findById(id: string): Promise<OrgRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async create(rec: OrgRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  private readonly rows: MembershipRecord[] = [];
  async create(rec: MembershipRecord): Promise<void> {
    this.rows.push(rec);
  }
  async listForUser(userId: string): Promise<MembershipRecord[]> {
    return this.rows.filter((m) => m.userId === userId);
  }
  async findRole(orgId: string, userId: string): Promise<Role | null> {
    return this.rows.find((m) => m.orgId === orgId && m.userId === userId)?.role ?? null;
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, SessionRecord>();
  async create(rec: SessionRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const s of this.byId.values()) if (s.tokenHash === tokenHash) return s;
    return null;
  }
  async revoke(id: string): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.revokedAt = new Date();
  }
  async revokeAllForUser(userId: string): Promise<void> {
    for (const s of this.byId.values()) if (s.userId === userId) s.revokedAt = new Date();
  }
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly byId = new Map<string, ProjectRecord>();
  async create(rec: ProjectRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async findById(id: string): Promise<ProjectRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async existsBySlug(orgId: string, slug: string): Promise<boolean> {
    for (const p of this.byId.values()) if (p.orgId === orgId && p.slug === slug) return true;
    return false;
  }
  async listForOrg(orgId: string): Promise<ProjectRecord[]> {
    return [...this.byId.values()].filter((p) => p.orgId === orgId);
  }
}

export class InMemorySliceRepository implements SliceRepository {
  private readonly rows: SliceRecord[] = [];
  async createMany(recs: SliceRecord[]): Promise<void> {
    this.rows.push(...recs);
  }
  async listForProject(projectId: string): Promise<SliceRecord[]> {
    return this.rows.filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
  }
  async findById(id: string): Promise<SliceRecord | null> {
    return this.rows.find((s) => s.id === id) ?? null;
  }
  async save(rec: SliceRecord): Promise<void> {
    const idx = this.rows.findIndex((s) => s.id === rec.id);
    if (idx >= 0) this.rows[idx] = rec;
    else this.rows.push(rec);
  }
  async delete(id: string): Promise<void> {
    const idx = this.rows.findIndex((s) => s.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }
}

export class InMemoryFeatureRepository implements FeatureRepository {
  private readonly byId = new Map<string, FeatureRecord>();
  async create(rec: FeatureRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async findById(id: string): Promise<FeatureRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async listForProject(projectId: string, sliceId?: string): Promise<FeatureRecord[]> {
    return [...this.byId.values()].filter(
      (f) => f.projectId === projectId && (sliceId === undefined || f.sliceId === sliceId),
    );
  }
  async save(rec: FeatureRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

export class InMemoryScenarioRepository implements ScenarioRepository {
  private rows: ScenarioRecord[] = [];
  async replaceForFeature(featureId: string, recs: ScenarioRecord[]): Promise<void> {
    this.rows = this.rows.filter((s) => s.featureId !== featureId);
    this.rows.push(...recs);
  }
  async listForFeature(featureId: string): Promise<ScenarioRecord[]> {
    return this.rows.filter((s) => s.featureId === featureId).sort((a, b) => a.order - b.order);
  }
  async deleteForFeature(featureId: string): Promise<void> {
    this.rows = this.rows.filter((s) => s.featureId !== featureId);
  }
  async setLastStatus(scenarioId: string, status: TestCaseStatus): Promise<void> {
    const s = this.rows.find((x) => x.id === scenarioId);
    if (s) s.lastStatus = status;
  }
}

export class InMemoryTestCaseRepository implements TestCaseRepository {
  private readonly byId = new Map<string, TestCaseRecord>();
  async create(rec: TestCaseRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async findById(id: string): Promise<TestCaseRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async listForProject(projectId: string, sliceId?: string): Promise<TestCaseRecord[]> {
    return [...this.byId.values()].filter(
      (t) => t.projectId === projectId && (sliceId === undefined || t.sliceId === sliceId),
    );
  }
  async save(rec: TestCaseRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

export class InMemoryRunRepository implements RunRepository {
  private readonly rows: RunRecord[] = [];
  async create(rec: RunRecord): Promise<void> {
    this.rows.push(rec);
  }
  async findById(id: string): Promise<RunRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listForProject(projectId: string): Promise<RunRecord[]> {
    // Newest-first (most recently inserted).
    return this.rows.filter((r) => r.projectId === projectId).reverse();
  }
}

export class InMemoryRunResultRepository implements RunResultRepository {
  private readonly rows: RunResultRecord[] = [];
  async createMany(recs: RunResultRecord[]): Promise<void> {
    this.rows.push(...recs);
  }
  async listForRun(runId: string): Promise<RunResultRecord[]> {
    return this.rows.filter((r) => r.runId === runId).sort((a, b) => a.order - b.order);
  }
}

export class InMemoryAgentRepository implements AgentRepository {
  private readonly rows: AgentRecord[] = [];
  async createMany(recs: AgentRecord[]): Promise<void> {
    this.rows.push(...recs);
  }
  async listForOrg(orgId: string): Promise<AgentRecord[]> {
    return this.rows.filter((a) => a.orgId === orgId);
  }
}

export class InMemoryToolBindingRepository implements ToolBindingRepository {
  private readonly rows: ToolBindingRecord[] = [];
  async createMany(recs: ToolBindingRecord[]): Promise<void> {
    this.rows.push(...recs);
  }
  async listForProject(projectId: string): Promise<ToolBindingRecord[]> {
    return this.rows.filter((t) => t.projectId === projectId);
  }
  async findByProjectAndAgent(projectId: string, agentId: string): Promise<ToolBindingRecord | null> {
    return this.rows.find((t) => t.projectId === projectId && t.agentId === agentId) ?? null;
  }
  async save(rec: ToolBindingRecord): Promise<void> {
    const idx = this.rows.findIndex((t) => t.id === rec.id);
    if (idx >= 0) this.rows[idx] = rec;
    else this.rows.push(rec);
  }
  async setEnabledForProject(projectId: string, enabled: boolean, at: Date): Promise<void> {
    for (const t of this.rows) {
      if (t.projectId === projectId) {
        t.enabled = enabled;
        t.updatedAt = at;
      }
    }
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byOrg = new Map<string, SubscriptionRecord>();
  async create(rec: SubscriptionRecord): Promise<void> {
    this.byOrg.set(rec.orgId, rec);
  }
  async findByOrg(orgId: string): Promise<SubscriptionRecord | null> {
    return this.byOrg.get(orgId) ?? null;
  }
  async save(rec: SubscriptionRecord): Promise<void> {
    this.byOrg.set(rec.orgId, rec);
  }
  async chargeRunMinutes(orgId: string, minutes: number): Promise<boolean> {
    const sub = this.byOrg.get(orgId);
    if (!sub) return true; // no subscription -> no metering, don't block
    if (sub.runMinutesUsed + minutes > sub.runMinutesQuota) return false;
    sub.runMinutesUsed += minutes;
    return true;
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly rows: AuditLogRecord[] = [];
  async append(rec: AuditLogRecord): Promise<void> {
    this.rows.push(rec);
  }
}

/**
 * Runs the work against the shared in-memory stores. There is no real isolation/rollback —
 * it exists so use cases can depend on the UnitOfWork port in Docker-free unit tests
 * (the actual rollback guarantee is exercised against Postgres by the integration suite).
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly repos: Repositories) {}
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return work(this.repos);
  }
}

export interface InMemoryContext {
  users: InMemoryUserRepository;
  orgs: InMemoryOrgRepository;
  memberships: InMemoryMembershipRepository;
  sessions: InMemorySessionRepository;
  projects: InMemoryProjectRepository;
  slices: InMemorySliceRepository;
  features: InMemoryFeatureRepository;
  scenarios: InMemoryScenarioRepository;
  testCases: InMemoryTestCaseRepository;
  runs: InMemoryRunRepository;
  runResults: InMemoryRunResultRepository;
  agents: InMemoryAgentRepository;
  toolBindings: InMemoryToolBindingRepository;
  subscriptions: InMemorySubscriptionRepository;
  audit: InMemoryAuditLogRepository;
  uow: InMemoryUnitOfWork;
  clock: FakeClock;
  ids: SeqIdGenerator;
  hasher: FakePasswordHasher;
  tokens: FakeTokenGenerator;
  brain: DeterministicBrain;
  kernel: DeterministicKernel;
  payment: MockPaymentProvider;
}

export function createInMemoryContext(): InMemoryContext {
  // Build the repos once; the UnitOfWork wraps the SAME instances so writes made inside a
  // transaction are visible to readers that resolve the repos directly.
  const repos = {
    users: new InMemoryUserRepository(),
    orgs: new InMemoryOrgRepository(),
    memberships: new InMemoryMembershipRepository(),
    sessions: new InMemorySessionRepository(),
    projects: new InMemoryProjectRepository(),
    slices: new InMemorySliceRepository(),
    features: new InMemoryFeatureRepository(),
    scenarios: new InMemoryScenarioRepository(),
    testCases: new InMemoryTestCaseRepository(),
    runs: new InMemoryRunRepository(),
    runResults: new InMemoryRunResultRepository(),
    agents: new InMemoryAgentRepository(),
    toolBindings: new InMemoryToolBindingRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
    audit: new InMemoryAuditLogRepository(),
  };
  return {
    ...repos,
    uow: new InMemoryUnitOfWork(repos),
    clock: new FakeClock(),
    ids: new SeqIdGenerator(),
    hasher: new FakePasswordHasher(),
    tokens: new FakeTokenGenerator(),
    brain: new DeterministicBrain(),
    kernel: new DeterministicKernel(),
    payment: new MockPaymentProvider(),
  };
}
