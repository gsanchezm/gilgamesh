import type {
  AgentRecord,
  AuditLogRecord,
  MembershipRecord,
  OrgRecord,
  ProjectRecord,
  Role,
  SessionRecord,
  SliceRecord,
  SubscriptionRecord,
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
