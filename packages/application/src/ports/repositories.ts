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
}

export interface ScenarioRepository {
  /** Replaces all scenarios for a feature (used on create + re-parse on update). */
  replaceForFeature(featureId: string, recs: ScenarioRecord[]): Promise<void>;
  listForFeature(featureId: string): Promise<ScenarioRecord[]>;
  deleteForFeature(featureId: string): Promise<void>;
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

export interface SubscriptionRepository {
  create(rec: SubscriptionRecord): Promise<void>;
  findByOrg(orgId: string): Promise<SubscriptionRecord | null>;
}

export interface AuditLogRepository {
  append(rec: AuditLogRecord): Promise<void>;
}
