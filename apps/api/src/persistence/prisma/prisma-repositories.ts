import type {
  AgentRecord,
  AgentRepository,
  AuditLogRecord,
  AuditLogRepository,
  MembershipRecord,
  MembershipRepository,
  OrgRecord,
  OrgRepository,
  ProjectRecord,
  ProjectRepository,
  Role,
  SessionRecord,
  SessionRepository,
  SliceRecord,
  SliceRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  ToolBindingRecord,
  ToolBindingRepository,
  UserRecord,
  UserRepository,
} from '@gilgamesh/application';
import { Prisma, type RepoProvider } from '@prisma/client';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  findByEmail(email: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { email } });
  }
  findById(id: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { id } });
  }
  async create(rec: UserRecord): Promise<void> {
    await this.db.user.create({ data: rec });
  }
}

export class PrismaOrgRepository implements OrgRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  findBySlug(slug: string): Promise<OrgRecord | null> {
    return this.db.org.findUnique({ where: { slug } });
  }
  findById(id: string): Promise<OrgRecord | null> {
    return this.db.org.findUnique({ where: { id } });
  }
  async create(rec: OrgRecord): Promise<void> {
    await this.db.org.create({ data: rec });
  }
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: MembershipRecord): Promise<void> {
    await this.db.membership.create({ data: rec });
  }
  listForUser(userId: string): Promise<MembershipRecord[]> {
    // Deterministic order: activeOrgId = memberships[0] is user-visible via MeView.
    return this.db.membership.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }
  async findRole(orgId: string, userId: string): Promise<Role | null> {
    const m = await this.db.membership.findUnique({ where: { orgId_userId: { orgId, userId } } });
    return m?.role ?? null;
  }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: SessionRecord): Promise<void> {
    await this.db.session.create({ data: rec });
  }
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }
  async revoke(id: string): Promise<void> {
    await this.db.session.update({ where: { id }, data: { revokedAt: new Date() } });
  }
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
  }
}

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: ProjectRecord): Promise<void> {
    await this.db.project.create({
      data: {
        id: rec.id,
        orgId: rec.orgId,
        name: rec.name,
        slug: rec.slug,
        format: rec.format,
        repoProvider: rec.repoProvider as RepoProvider | null,
        repoFullName: rec.repoFullName,
        repoBranch: rec.repoBranch,
        repoCommit: rec.repoCommit,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      },
    });
  }
  findById(id: string): Promise<ProjectRecord | null> {
    return this.db.project.findUnique({ where: { id } });
  }
  async existsBySlug(orgId: string, slug: string): Promise<boolean> {
    const found = await this.db.project.findUnique({ where: { orgId_slug: { orgId, slug } } });
    return found !== null;
  }
  listForOrg(orgId: string): Promise<ProjectRecord[]> {
    return this.db.project.findMany({ where: { orgId } });
  }
}

export class PrismaSliceRepository implements SliceRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async createMany(recs: SliceRecord[]): Promise<void> {
    await this.db.slice.createMany({ data: recs });
  }
  listForProject(projectId: string): Promise<SliceRecord[]> {
    return this.db.slice.findMany({ where: { projectId } });
  }
}

export class PrismaAgentRepository implements AgentRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async createMany(recs: AgentRecord[]): Promise<void> {
    await this.db.agent.createMany({ data: recs });
  }
  listForOrg(orgId: string): Promise<AgentRecord[]> {
    return this.db.agent.findMany({ where: { orgId } });
  }
}

export class PrismaToolBindingRepository implements ToolBindingRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async createMany(recs: ToolBindingRecord[]): Promise<void> {
    await this.db.toolBinding.createMany({ data: recs });
  }
  listForProject(projectId: string): Promise<ToolBindingRecord[]> {
    return this.db.toolBinding.findMany({ where: { projectId } });
  }
  findByProjectAndAgent(projectId: string, agentId: string): Promise<ToolBindingRecord | null> {
    return this.db.toolBinding.findUnique({ where: { projectId_agentId: { projectId, agentId } } });
  }
  async save(rec: ToolBindingRecord): Promise<void> {
    await this.db.toolBinding.update({
      where: { id: rec.id },
      data: { tool: rec.tool, enabled: rec.enabled, updatedAt: rec.updatedAt },
    });
  }
  async setEnabledForProject(projectId: string, enabled: boolean, at: Date): Promise<void> {
    await this.db.toolBinding.updateMany({ where: { projectId }, data: { enabled, updatedAt: at } });
  }
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: SubscriptionRecord): Promise<void> {
    await this.db.subscription.create({ data: rec });
  }
  findByOrg(orgId: string): Promise<SubscriptionRecord | null> {
    return this.db.subscription.findUnique({ where: { orgId } });
  }
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async append(rec: AuditLogRecord): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: rec.id,
        orgId: rec.orgId,
        actorUserId: rec.actorUserId,
        action: rec.action,
        targetType: rec.targetType,
        targetId: rec.targetId,
        metadata: rec.metadata as Prisma.InputJsonValue,
        ip: rec.ip,
        createdAt: rec.createdAt,
      },
    });
  }
}
