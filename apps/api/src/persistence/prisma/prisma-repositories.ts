import type {
  AgentRecord,
  AgentRepository,
  AuditLogRecord,
  AuditLogRepository,
  FeatureRecord,
  FeatureRepository,
  MembershipRecord,
  MembershipRepository,
  OrgRecord,
  OrgRepository,
  ProjectRecord,
  ProjectRepository,
  Role,
  RunRecord,
  RunRepository,
  RunResultRecord,
  RunResultRepository,
  ScenarioRecord,
  ScenarioRepository,
  SessionRecord,
  SessionRepository,
  SliceRecord,
  SliceRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  TestCaseRecord,
  TestCaseRepository,
  TestCaseStatus,
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
    return this.db.slice.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
  }
  findById(id: string): Promise<SliceRecord | null> {
    return this.db.slice.findUnique({ where: { id } });
  }
  async save(rec: SliceRecord): Promise<void> {
    await this.db.slice.upsert({ where: { id: rec.id }, create: rec, update: rec });
  }
  async delete(id: string): Promise<void> {
    await this.db.slice.delete({ where: { id } });
  }
}

export class PrismaFeatureRepository implements FeatureRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: FeatureRecord): Promise<void> {
    await this.db.feature.create({ data: rec });
  }
  findById(id: string): Promise<FeatureRecord | null> {
    return this.db.feature.findUnique({ where: { id } });
  }
  listForProject(projectId: string, sliceId?: string): Promise<FeatureRecord[]> {
    return this.db.feature.findMany({
      where: { projectId, ...(sliceId !== undefined ? { sliceId } : {}) },
      // Deterministic creation order (id asc = UUID v7 tiebreaker), matching the in-memory adapter.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async save(rec: FeatureRecord): Promise<void> {
    await this.db.feature.update({ where: { id: rec.id }, data: rec });
  }
  async delete(id: string): Promise<void> {
    await this.db.feature.delete({ where: { id } });
  }
}

export class PrismaScenarioRepository implements ScenarioRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async replaceForFeature(featureId: string, recs: ScenarioRecord[]): Promise<void> {
    await this.db.scenario.deleteMany({ where: { featureId } });
    if (recs.length > 0) await this.db.scenario.createMany({ data: recs });
  }
  listForFeature(featureId: string): Promise<ScenarioRecord[]> {
    return this.db.scenario.findMany({ where: { featureId }, orderBy: { order: 'asc' } });
  }
  async deleteForFeature(featureId: string): Promise<void> {
    await this.db.scenario.deleteMany({ where: { featureId } });
  }
  async setLastStatus(scenarioId: string, status: TestCaseStatus): Promise<void> {
    // updateMany (not update) so a concurrently-deleted scenario is a no-op, never a P2025.
    await this.db.scenario.updateMany({ where: { id: scenarioId }, data: { lastStatus: status } });
  }
}

export class PrismaTestCaseRepository implements TestCaseRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: TestCaseRecord): Promise<void> {
    await this.db.testCase.create({ data: rec });
  }
  findById(id: string): Promise<TestCaseRecord | null> {
    return this.db.testCase.findUnique({ where: { id } });
  }
  listForProject(projectId: string, sliceId?: string): Promise<TestCaseRecord[]> {
    return this.db.testCase.findMany({
      where: { projectId, ...(sliceId !== undefined ? { sliceId } : {}) },
      // key is the monotonic per-project auto-number (TC_PRJ_001…), so key asc = creation order.
      orderBy: { key: 'asc' },
    });
  }
  async save(rec: TestCaseRecord): Promise<void> {
    await this.db.testCase.update({ where: { id: rec.id }, data: rec });
  }
  async delete(id: string): Promise<void> {
    await this.db.testCase.delete({ where: { id } });
  }
}

export class PrismaRunRepository implements RunRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async create(rec: RunRecord): Promise<void> {
    await this.db.run.create({ data: rec });
  }
  findById(id: string): Promise<RunRecord | null> {
    return this.db.run.findUnique({ where: { id } });
  }
  listForProject(projectId: string): Promise<RunRecord[]> {
    // id desc (UUID v7 = time-ordered) is a stable tiebreaker for same-millisecond createdAt.
    return this.db.run.findMany({ where: { projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }
}

export class PrismaRunResultRepository implements RunResultRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async createMany(recs: RunResultRecord[]): Promise<void> {
    if (recs.length > 0) await this.db.runResult.createMany({ data: recs });
  }
  listForRun(runId: string): Promise<RunResultRecord[]> {
    return this.db.runResult.findMany({ where: { runId }, orderBy: { order: 'asc' } });
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
