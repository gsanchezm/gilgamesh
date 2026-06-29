import type {
  AgentRepository,
  AuditLogRepository,
  MembershipRepository,
  OrgRepository,
  ProjectRepository,
  SessionRepository,
  SliceRepository,
  SubscriptionRepository,
  ToolBindingRepository,
  UserRepository,
} from '../ports/repositories';
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
} from '../ports/records';
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
    return this.rows.filter((s) => s.projectId === projectId);
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
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly rows: AuditLogRecord[] = [];
  async append(rec: AuditLogRecord): Promise<void> {
    this.rows.push(rec);
  }
}

export interface InMemoryContext {
  users: InMemoryUserRepository;
  orgs: InMemoryOrgRepository;
  memberships: InMemoryMembershipRepository;
  sessions: InMemorySessionRepository;
  projects: InMemoryProjectRepository;
  slices: InMemorySliceRepository;
  agents: InMemoryAgentRepository;
  toolBindings: InMemoryToolBindingRepository;
  subscriptions: InMemorySubscriptionRepository;
  audit: InMemoryAuditLogRepository;
  clock: FakeClock;
  ids: SeqIdGenerator;
  hasher: FakePasswordHasher;
  tokens: FakeTokenGenerator;
}

export function createInMemoryContext(): InMemoryContext {
  return {
    users: new InMemoryUserRepository(),
    orgs: new InMemoryOrgRepository(),
    memberships: new InMemoryMembershipRepository(),
    sessions: new InMemorySessionRepository(),
    projects: new InMemoryProjectRepository(),
    slices: new InMemorySliceRepository(),
    agents: new InMemoryAgentRepository(),
    toolBindings: new InMemoryToolBindingRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
    audit: new InMemoryAuditLogRepository(),
    clock: new FakeClock(),
    ids: new SeqIdGenerator(),
    hasher: new FakePasswordHasher(),
    tokens: new FakeTokenGenerator(),
  };
}
