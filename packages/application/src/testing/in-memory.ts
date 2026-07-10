import type {
  AgentRepository,
  AuditLogRepository,
  BrainUsageRepository,
  ChatMessageRepository,
  ChatSessionRepository,
  FeatureRepository,
  IntegrationRepository,
  InvoiceRepository,
  MembershipRepository,
  OrgRepository,
  PasswordResetRepository,
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
import { cosineSimilarity } from '@gilgamesh/domain';
import type {
  KnowledgeChunkRepository,
  KnowledgeDocumentRepository,
  ScopedRetrievalFilter,
  ScoredChunk,
} from '../ports/knowledge';
import { KnowledgeRetriever } from '../use-cases/knowledge';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work';
import type {
  AgentRecord,
  AuditLogRecord,
  BrainUsageRecord,
  ChatMessageRecord,
  ChatSessionRecord,
  FeatureRecord,
  IntegrationRecord,
  InvoiceRecord,
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
  MembershipRecord,
  OrgRecord,
  PasswordResetRecord,
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
import { BRAIN_TOKENS_USED_CAP, BrainBilling } from '../brain/token-billing';
import { DeterministicKernel } from '../kernel/deterministic-kernel';
import { ApplyPaymentEvent } from '../payment/apply-payment-event';
import { MockPaymentProvider } from '../payment/mock-payment-provider';
import { MockRepoProvider, StubBrainKeyVerifier, StubSecretVault } from '../integrations/mock-repo-provider';
import type { EventBus } from '../ports/events';
import { StubEmail } from '../email/stub-email';
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
  async updatePassword(id: string, passwordHash: string, updatedAt: Date): Promise<void> {
    const existing = this.byId.get(id);
    if (existing) this.byId.set(id, { ...existing, passwordHash, updatedAt });
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

export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  /** Exposed for tests (the port itself never lists). */
  readonly rows: PasswordResetRecord[] = [];
  async create(rec: PasswordResetRecord): Promise<void> {
    this.rows.push(rec);
  }
  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
  }
  async claimUnused(id: string, at: Date): Promise<boolean> {
    // Synchronous check-and-set (no await between them) = atomic under JS interleaving.
    const rec = this.rows.find((r) => r.id === id);
    if (!rec || rec.usedAt !== null) return false;
    rec.usedAt = at;
    return true;
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
  async save(rec: ProjectRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async linkRepo(
    id: string,
    repo: { repoProvider: string | null; repoFullName: string | null; repoBranch: string | null; repoLastSyncAt: Date | null; updatedAt: Date },
  ): Promise<void> {
    const existing = this.byId.get(id);
    if (existing) this.byId.set(id, { ...existing, ...repo });
  }
}

export class InMemoryIntegrationRepository implements IntegrationRepository {
  private readonly byOrgKey = new Map<string, IntegrationRecord>();
  private k(orgId: string, key: string): string {
    return `${orgId}::${key}`;
  }
  async listForOrg(orgId: string): Promise<IntegrationRecord[]> {
    return [...this.byOrgKey.values()].filter((r) => r.orgId === orgId).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  async findByKey(orgId: string, key: string): Promise<IntegrationRecord | null> {
    return this.byOrgKey.get(this.k(orgId, key)) ?? null;
  }
  async upsert(rec: IntegrationRecord): Promise<void> {
    this.byOrgKey.set(this.k(rec.orgId, rec.key), rec);
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
    return [...this.byId.values()]
      .filter((f) => f.projectId === projectId && (sliceId === undefined || f.sliceId === sliceId))
      // Mirror PrismaFeatureRepository: createdAt asc, id asc tiebreak (deterministic creation order).
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  async save(rec: FeatureRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
  async upsertByPath(rec: FeatureRecord): Promise<FeatureRecord> {
    const existing = [...this.byId.values()].find((f) => f.projectId === rec.projectId && f.path === rec.path);
    if (existing) {
      const merged = { ...existing, name: rec.name, content: rec.content, updatedAt: rec.updatedAt };
      this.byId.set(existing.id, merged);
      return merged;
    }
    this.byId.set(rec.id, rec);
    return rec;
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
  async countByFeature(featureIds: string[]): Promise<Map<string, number>> {
    const wanted = new Set(featureIds);
    const counts = new Map<string, number>();
    for (const s of this.rows) {
      if (wanted.has(s.featureId)) counts.set(s.featureId, (counts.get(s.featureId) ?? 0) + 1);
    }
    return counts;
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
    return [...this.byId.values()]
      .filter((t) => t.projectId === projectId && (sliceId === undefined || t.sliceId === sliceId))
      // Mirror PrismaTestCaseRepository: key asc = monotonic creation order (TC_PRJ_001…).
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
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
    // Mirror PrismaRunRepository: createdAt desc, id desc tiebreak (newest run first, deterministic).
    return this.rows
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
    // The usage counters are OWNED by the charge methods (review S14 #1): an existing row keeps
    // its committed counters — a stale admin snapshot (plan/seats/status/checkout) can never
    // clobber a concurrent charge. Mirrors the Prisma adapter's column-omitting UPDATE.
    const existing = this.byOrg.get(rec.orgId);
    this.byOrg.set(
      rec.orgId,
      existing
        ? { ...rec, runMinutesUsed: existing.runMinutesUsed, brainTokensUsed: existing.brainTokensUsed }
        : rec,
    );
  }
  async chargeRunMinutes(orgId: string, minutes: number): Promise<boolean> {
    const sub = this.byOrg.get(orgId);
    if (!sub) return true; // no subscription -> no metering, don't block
    if (sub.runMinutesUsed + minutes > sub.runMinutesQuota) return false;
    sub.runMinutesUsed += minutes;
    return true;
  }
  async chargeBrainTokens(orgId: string, tokens: number): Promise<void> {
    // Unconditional increment (S14): the cost is known only after the call — the pre-check gates.
    // Saturates at BRAIN_TOKENS_USED_CAP (int4 headroom; review S14 #2) like the Prisma LEAST().
    const sub = this.byOrg.get(orgId);
    if (sub) sub.brainTokensUsed = Math.min(sub.brainTokensUsed + tokens, BRAIN_TOKENS_USED_CAP);
  }
  async resetUsage(orgId?: string): Promise<number> {
    // Period rollover (slice 21, S14-6): BOTH counters to 0 TOGETHER — the synchronous loop makes
    // that atomic under JS interleaving (no await between the two writes). Counts every MATCHED row
    // (even one already at zero) so a no-change reset still reports 1, mirroring Postgres' affected
    // count for a no-op UPDATE. Omitting orgId targets every subscription.
    let reset = 0;
    for (const sub of this.byOrg.values()) {
      if (orgId !== undefined && sub.orgId !== orgId) continue;
      sub.runMinutesUsed = 0;
      sub.brainTokensUsed = 0;
      reset += 1;
    }
    return reset;
  }
  async findByProviderCustomerId(providerCustomerId: string): Promise<SubscriptionRecord | null> {
    for (const s of this.byOrg.values()) if (s.providerCustomerId === providerCustomerId) return s;
    return null;
  }
}

export class InMemoryInvoiceRepository implements InvoiceRepository {
  private readonly byId = new Map<string, InvoiceRecord>();
  async listForOrg(orgId: string): Promise<InvoiceRecord[]> {
    return [...this.byId.values()]
      .filter((i) => i.orgId === orgId)
      // Newest-first; id desc tiebreak mirrors the Prisma ordering so same-ms rows don't diverge.
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
  }
  async upsertByProviderInvoiceId(rec: InvoiceRecord): Promise<void> {
    const existing = rec.providerInvoiceId
      ? [...this.byId.values()].find((i) => i.providerInvoiceId === rec.providerInvoiceId)
      : undefined;
    if (!existing) {
      this.byId.set(rec.id, { ...rec });
      return;
    }
    // Mirror the Prisma upsert: only the lifecycle fields change; id/orgId/createdAt are preserved
    // so webhook redelivery can never duplicate a row or move it across orgs.
    this.byId.set(existing.id, {
      ...existing,
      status: rec.status,
      amountCents: rec.amountCents,
      currency: rec.currency,
      periodStart: rec.periodStart,
      periodEnd: rec.periodEnd,
      hostedInvoiceUrl: rec.hostedInvoiceUrl,
      pdfUrl: rec.pdfUrl,
      updatedAt: rec.updatedAt,
    });
  }
}

export class InMemoryKnowledgeChunkRepository implements KnowledgeChunkRepository {
  private readonly byId = new Map<string, KnowledgeChunkRecord>();
  async upsertMany(chunks: KnowledgeChunkRecord[]): Promise<void> {
    for (const c of chunks) this.byId.set(c.id, c);
  }
  async search(queryEmbedding: number[], k: number): Promise<ScoredChunk[]> {
    return [...this.byId.values()]
      // Shared corpus only (orgId null) — per-org uploaded chunks never surface in the global search.
      .filter((chunk) => chunk.orgId == null)
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      // Deterministic tiebreak by id (mirrors the Prisma `ORDER BY … , id`) so ties don't diverge.
      .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0))
      .slice(0, k);
  }
  async searchScoped(filter: ScopedRetrievalFilter, queryEmbedding: number[], k: number): Promise<ScoredChunk[]> {
    return [...this.byId.values()]
      // Visible within this org: own-org or global chunks, scoped to 'shared'/NULL — plus the agent's
      // slot when the filter carries one (agent-scoped chunks stay private to that agent's chat).
      .filter(
        (chunk) =>
          (chunk.orgId == null || chunk.orgId === filter.orgId) &&
          (chunk.scope == null ||
            chunk.scope === 'shared' ||
            (filter.slot != null && chunk.scope === filter.slot)),
      )
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0))
      .slice(0, k);
  }
  async count(): Promise<number> {
    let n = 0;
    for (const c of this.byId.values()) if (c.orgId == null) n += 1;
    return n;
  }
}

export class InMemoryKnowledgeDocumentRepository implements KnowledgeDocumentRepository {
  private readonly rows: KnowledgeDocumentRecord[] = [];
  async create(doc: KnowledgeDocumentRecord): Promise<void> {
    this.rows.push(doc);
  }
  async listForOrg(orgId: string): Promise<KnowledgeDocumentRecord[]> {
    return this.rows
      .filter((d) => d.orgId === orgId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }
}

export class InMemoryChatSessionRepository implements ChatSessionRepository {
  private readonly byId = new Map<string, ChatSessionRecord>();
  async create(rec: ChatSessionRecord): Promise<void> {
    this.byId.set(rec.id, rec);
  }
  async findById(id: string): Promise<ChatSessionRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async touch(id: string, at: Date): Promise<void> {
    const s = this.byId.get(id);
    if (s) s.updatedAt = at;
  }
  async listForProject(projectId: string): Promise<ChatSessionRecord[]> {
    // Mirror PrismaChatSessionRepository: updatedAt desc, id desc tiebreak (newest activity first).
    return [...this.byId.values()]
      .filter((s) => s.projectId === projectId)
      .sort(
        (a, b) =>
          b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
  }
}

export class InMemoryChatMessageRepository implements ChatMessageRepository {
  private readonly rows: ChatMessageRecord[] = [];
  async create(rec: ChatMessageRecord): Promise<void> {
    this.rows.push(rec);
  }
  async listForSession(sessionId: string): Promise<ChatMessageRecord[]> {
    // createdAt asc; the stable sort keeps insertion order on same-ms ties (Prisma parity: its
    // `createdAt asc, id asc` yields creation order too, since UUID v7 ids are time-ordered).
    return this.rows
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async setRunId(id: string, runId: string): Promise<void> {
    const m = this.rows.find((x) => x.id === id);
    if (m) m.runId = runId;
  }
  async firstUserMessageBySession(sessionIds: string[]): Promise<ChatMessageRecord[]> {
    // Mirror the Prisma adapter (distinct-on over createdAt asc, id asc): the first USER message
    // per requested session; sessions without one are absent. Batched — never per-session.
    const wanted = new Set(sessionIds);
    const firsts = new Map<string, ChatMessageRecord>();
    const ordered = [...this.rows].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const m of ordered) {
      if (m.role !== 'USER' || !wanted.has(m.sessionId) || firsts.has(m.sessionId)) continue;
      firsts.set(m.sessionId, m);
    }
    return [...firsts.values()];
  }
}

export class InMemoryBrainUsageRepository implements BrainUsageRepository {
  readonly rows: BrainUsageRecord[] = [];
  async append(rec: BrainUsageRecord): Promise<void> {
    this.rows.push(rec);
  }
  async listForOrg(orgId: string): Promise<BrainUsageRecord[]> {
    return this.rows.filter((r) => r.orgId === orgId);
  }
}

/** In-process pub/sub implementing the frozen s5 EventBus (slice 9 live SSE). */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<(e: unknown) => void>>();
  async publish(topic: string, e: unknown): Promise<void> {
    for (const h of [...(this.handlers.get(topic) ?? [])]) h(e);
  }
  subscribe(topic: string, h: (e: unknown) => void): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(h);
    return () => {
      this.handlers.get(topic)?.delete(h);
    };
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
  passwordResets: InMemoryPasswordResetRepository;
  email: StubEmail;
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
  invoices: InMemoryInvoiceRepository;
  audit: InMemoryAuditLogRepository;
  knowledge: InMemoryKnowledgeChunkRepository;
  knowledgeDocuments: InMemoryKnowledgeDocumentRepository;
  chatSessions: InMemoryChatSessionRepository;
  chatMessages: InMemoryChatMessageRepository;
  brainUsage: InMemoryBrainUsageRepository;
  /** S14: the shared token check/charge seam, wired over the same uow/subscriptions/brainUsage. */
  billing: BrainBilling;
  events: InMemoryEventBus;
  brainKeys: StubBrainKeyVerifier;
  integrations: InMemoryIntegrationRepository;
  repoProvider: MockRepoProvider;
  vault: StubSecretVault;
  uow: InMemoryUnitOfWork;
  clock: FakeClock;
  ids: SeqIdGenerator;
  hasher: FakePasswordHasher;
  tokens: FakeTokenGenerator;
  brain: DeterministicBrain;
  kernel: DeterministicKernel;
  payment: MockPaymentProvider;
  retrieval: KnowledgeRetriever;
}

export function createInMemoryContext(): InMemoryContext {
  // Build the repos once; the UnitOfWork wraps the SAME instances so writes made inside a
  // transaction are visible to readers that resolve the repos directly.
  const knowledge = new InMemoryKnowledgeChunkRepository();
  const knowledgeDocuments = new InMemoryKnowledgeDocumentRepository();
  const repos = {
    users: new InMemoryUserRepository(),
    orgs: new InMemoryOrgRepository(),
    memberships: new InMemoryMembershipRepository(),
    sessions: new InMemorySessionRepository(),
    passwordResets: new InMemoryPasswordResetRepository(),
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
    invoices: new InMemoryInvoiceRepository(),
    audit: new InMemoryAuditLogRepository(),
    knowledge,
    knowledgeDocuments,
    // In the UoW bundle since S14: the usage row + the token charge commit together.
    brainUsage: new InMemoryBrainUsageRepository(),
  };
  const brain = new DeterministicBrain();
  const uow = new InMemoryUnitOfWork(repos);
  const clock = new FakeClock();
  const ids = new SeqIdGenerator();
  return {
    ...repos,
    email: new StubEmail(),
    chatSessions: new InMemoryChatSessionRepository(),
    chatMessages: new InMemoryChatMessageRepository(),
    billing: new BrainBilling({ uow, subscriptions: repos.subscriptions, ids, clock }),
    events: new InMemoryEventBus(),
    brainKeys: new StubBrainKeyVerifier(),
    integrations: new InMemoryIntegrationRepository(),
    repoProvider: new MockRepoProvider(),
    vault: new StubSecretVault(),
    uow,
    clock,
    ids,
    hasher: new FakePasswordHasher(),
    tokens: new FakeTokenGenerator(),
    brain,
    kernel: new DeterministicKernel(),
    // Deterministic offline payments (slice 13): confirm/webhooks persist Invoice rows via the
    // shared ApplyPaymentEvent seam, exactly like the production in-memory wiring.
    payment: new MockPaymentProvider({
      events: new ApplyPaymentEvent({ uow, ids, clock }),
      invoices: repos.invoices,
      subscriptions: repos.subscriptions,
      // S40: the mock computes proration from the injected clock + currentPeriodEnd (no Date.now).
      clock,
    }),
    retrieval: new KnowledgeRetriever({ knowledge, brain }),
  };
}
