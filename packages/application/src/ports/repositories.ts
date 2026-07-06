import type {
  AgentRecord,
  AuditLogRecord,
  BrainUsageRecord,
  ChatMessageRecord,
  ChatSessionRecord,
  FeatureRecord,
  IntegrationRecord,
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
} from './records';

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(rec: UserRecord): Promise<void>;
}

export interface OrgRepository {
  findBySlug(slug: string): Promise<OrgRecord | null>;
  findById(id: string): Promise<OrgRecord | null>;
  create(rec: OrgRecord): Promise<void>;
}

export interface MembershipRepository {
  create(rec: MembershipRecord): Promise<void>;
  listForUser(userId: string): Promise<MembershipRecord[]>;
  findRole(orgId: string, userId: string): Promise<Role | null>;
}

export interface SessionRepository {
  create(rec: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}

export interface ProjectRepository {
  create(rec: ProjectRecord): Promise<void>;
  findById(id: string): Promise<ProjectRecord | null>;
  existsBySlug(orgId: string, slug: string): Promise<boolean>;
  listForOrg(orgId: string): Promise<ProjectRecord[]>;
  save(rec: ProjectRecord): Promise<void>;
  /** Targeted update of ONLY the repo-link columns — never clobbers name/slug/format from a stale snapshot. */
  linkRepo(
    id: string,
    repo: {
      repoProvider: string | null;
      repoFullName: string | null;
      repoBranch: string | null;
      repoLastSyncAt: Date | null;
      updatedAt: Date;
    },
  ): Promise<void>;
}

export interface SliceRepository {
  createMany(recs: SliceRecord[]): Promise<void>;
  listForProject(projectId: string): Promise<SliceRecord[]>;
  findById(id: string): Promise<SliceRecord | null>;
  save(rec: SliceRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface FeatureRepository {
  create(rec: FeatureRecord): Promise<void>;
  findById(id: string): Promise<FeatureRecord | null>;
  listForProject(projectId: string, sliceId?: string): Promise<FeatureRecord[]>;
  save(rec: FeatureRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Atomic create-or-update keyed on (projectId, path) — concurrency-safe idempotent repo import. On an
   * existing path, only name/content/updatedAt change (id/sliceId/createdAt are preserved). Returns the
   * persisted record (its id is authoritative for scenario writes, even when a concurrent insert won).
   */
  upsertByPath(rec: FeatureRecord): Promise<FeatureRecord>;
}

export interface ScenarioRepository {
  /** Replaces all scenarios for a feature (used on create + re-parse on update). */
  replaceForFeature(featureId: string, recs: ScenarioRecord[]): Promise<void>;
  listForFeature(featureId: string): Promise<ScenarioRecord[]>;
  /** Scenario counts grouped by feature id (one aggregate query) — avoids the per-feature N+1 in ListFeatures. */
  countByFeature(featureIds: string[]): Promise<Map<string, number>>;
  deleteForFeature(featureId: string): Promise<void>;
  /** Updates one scenario's last run status in place by id; a no-op if the row is gone. */
  setLastStatus(scenarioId: string, status: TestCaseStatus): Promise<void>;
}

export interface TestCaseRepository {
  create(rec: TestCaseRecord): Promise<void>;
  findById(id: string): Promise<TestCaseRecord | null>;
  listForProject(projectId: string, sliceId?: string): Promise<TestCaseRecord[]>;
  save(rec: TestCaseRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RunRepository {
  create(rec: RunRecord): Promise<void>;
  findById(id: string): Promise<RunRecord | null>;
  /** Newest-first run history for a project. */
  listForProject(projectId: string): Promise<RunRecord[]>;
}

export interface RunResultRepository {
  createMany(recs: RunResultRecord[]): Promise<void>;
  listForRun(runId: string): Promise<RunResultRecord[]>;
}

export interface AgentRepository {
  createMany(recs: AgentRecord[]): Promise<void>;
  listForOrg(orgId: string): Promise<AgentRecord[]>;
}

export interface ToolBindingRepository {
  createMany(recs: ToolBindingRecord[]): Promise<void>;
  listForProject(projectId: string): Promise<ToolBindingRecord[]>;
  findByProjectAndAgent(projectId: string, agentId: string): Promise<ToolBindingRecord | null>;
  save(rec: ToolBindingRecord): Promise<void>;
  setEnabledForProject(projectId: string, enabled: boolean, at: Date): Promise<void>;
}

export interface IntegrationRepository {
  listForOrg(orgId: string): Promise<IntegrationRecord[]>;
  findByKey(orgId: string, key: string): Promise<IntegrationRecord | null>;
  upsert(rec: IntegrationRecord): Promise<void>;
}

export interface SubscriptionRepository {
  create(rec: SubscriptionRecord): Promise<void>;
  findByOrg(orgId: string): Promise<SubscriptionRecord | null>;
  save(rec: SubscriptionRecord): Promise<void>;
  /**
   * Atomically adds `minutes` to runMinutesUsed IFF it stays within runMinutesQuota; returns false
   * (no write) if it would exceed. Touches only the counter — never the snapshot's other columns —
   * so a concurrent plan/checkout/cancel can't be clobbered (slice-4 review fix).
   */
  chargeRunMinutes(orgId: string, minutes: number): Promise<boolean>;
}

export interface ChatSessionRepository {
  create(rec: ChatSessionRecord): Promise<void>;
  findById(id: string): Promise<ChatSessionRecord | null>;
  /** Bumps updatedAt when a message lands; a no-op if the session is gone. */
  touch(id: string, at: Date): Promise<void>;
}

export interface ChatMessageRepository {
  create(rec: ChatMessageRecord): Promise<void>;
  /** Conversation order: createdAt asc, id asc tiebreak (UUID v7 = creation order on same-ms ties). */
  listForSession(sessionId: string): Promise<ChatMessageRecord[]>;
  /** Links the triggering message to its Run after the standard run path commits; no-op if gone. */
  setRunId(id: string, runId: string): Promise<void>;
}

export interface BrainUsageRepository {
  append(rec: BrainUsageRecord): Promise<void>;
  listForOrg(orgId: string): Promise<BrainUsageRecord[]>;
}

export interface AuditLogRepository {
  append(rec: AuditLogRecord): Promise<void>;
}
