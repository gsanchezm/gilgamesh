import type {
  AgentRecord,
  AgentRepository,
  AuditLogRecord,
  AuditLogRepository,
  FeatureRecord,
  FeatureRepository,
  IntegrationGroup,
  IntegrationRecord,
  IntegrationRepository,
  KnowledgeChunkRecord,
  KnowledgeChunkRepository,
  MembershipRecord,
  MembershipRepository,
  ScoredChunk,
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
        repoLastSyncAt: rec.repoLastSyncAt,
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
  async save(rec: ProjectRecord): Promise<void> {
    await this.db.project.update({
      where: { id: rec.id },
      data: {
        name: rec.name,
        slug: rec.slug,
        format: rec.format,
        repoProvider: rec.repoProvider as RepoProvider | null,
        repoFullName: rec.repoFullName,
        repoBranch: rec.repoBranch,
        repoCommit: rec.repoCommit,
        repoLastSyncAt: rec.repoLastSyncAt,
        updatedAt: rec.updatedAt,
      },
    });
  }
  async linkRepo(
    id: string,
    repo: { repoProvider: string | null; repoFullName: string | null; repoBranch: string | null; repoLastSyncAt: Date | null; updatedAt: Date },
  ): Promise<void> {
    await this.db.project.update({
      where: { id },
      data: {
        repoProvider: repo.repoProvider as RepoProvider | null,
        repoFullName: repo.repoFullName,
        repoBranch: repo.repoBranch,
        repoLastSyncAt: repo.repoLastSyncAt,
        updatedAt: repo.updatedAt,
      },
    });
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
  async upsertByPath(rec: FeatureRecord): Promise<FeatureRecord> {
    return this.db.feature.upsert({
      where: { projectId_path: { projectId: rec.projectId, path: rec.path } },
      create: rec,
      update: { name: rec.name, content: rec.content, updatedAt: rec.updatedAt },
    });
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
  async save(rec: SubscriptionRecord): Promise<void> {
    await this.db.subscription.update({ where: { id: rec.id }, data: rec });
  }
  async chargeRunMinutes(orgId: string, minutes: number): Promise<boolean> {
    // Atomic conditional increment: the DB checks the quota and bumps the counter in one statement,
    // so concurrent runs can't both pass a stale check (no TOCTOU, no lost update).
    const affected = await this.db.$executeRaw`
      UPDATE subscriptions
      SET run_minutes_used = run_minutes_used + ${minutes}
      WHERE org_id = ${orgId}::uuid AND run_minutes_used + ${minutes} <= run_minutes_quota`;
    if (affected > 0) return true;
    // 0 rows: either no subscription (don't block) or the quota guard rejected it (block).
    const exists = await this.db.subscription.count({ where: { orgId } });
    return exists === 0;
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

interface KnowledgeSearchRow {
  id: string;
  source: string;
  headingPath: string[] | null;
  section: string;
  content: string;
  tokenEstimate: number;
  score: number;
}

/**
 * The global shared knowledge base on pgvector. `embedding` is an Unsupported column, so writes and the
 * cosine-similarity search go through raw SQL; `count` uses the typed client (slice 5).
 */
export class PrismaKnowledgeChunkRepository implements KnowledgeChunkRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async upsertMany(chunks: KnowledgeChunkRecord[]): Promise<void> {
    for (const c of chunks) {
      const vec = `[${c.embedding.join(',')}]`;
      await this.db.$executeRaw`
        INSERT INTO knowledge_chunks (id, source, heading_path, section, content, embedding, token_estimate)
        VALUES (${c.id}, ${c.source}, ${c.headingPath}, ${c.section}, ${c.content}, ${vec}::vector, ${c.tokenEstimate})
        ON CONFLICT (id) DO UPDATE SET
          source = EXCLUDED.source,
          heading_path = EXCLUDED.heading_path,
          section = EXCLUDED.section,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          token_estimate = EXCLUDED.token_estimate`;
    }
  }

  async search(queryEmbedding: number[], k: number): Promise<ScoredChunk[]> {
    const vec = `[${queryEmbedding.join(',')}]`;
    const rows = await this.db.$queryRaw<KnowledgeSearchRow[]>`
      SELECT id, source, heading_path AS "headingPath", section, content,
             token_estimate AS "tokenEstimate", 1 - (embedding <=> ${vec}::vector) AS score
      FROM knowledge_chunks
      ORDER BY embedding <=> ${vec}::vector, id
      LIMIT ${k}`;
    return rows.map((r) => ({
      chunk: {
        id: r.id,
        source: r.source,
        headingPath: r.headingPath ?? [],
        section: r.section,
        content: r.content,
        embedding: [], // not needed by consumers of search results
        tokenEstimate: Number(r.tokenEstimate),
      },
      score: Number(r.score),
    }));
  }

  async count(): Promise<number> {
    return this.db.knowledgeChunk.count();
  }
}

function toIntegrationRecord(row: {
  id: string;
  orgId: string;
  key: string;
  group: string;
  connected: boolean;
  secretRef: string | null;
  config: Prisma.JsonValue;
  connectedById: string | null;
  connectedAt: Date | null;
}): IntegrationRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    key: row.key,
    group: row.group as IntegrationGroup,
    connected: row.connected,
    secretRef: row.secretRef,
    config: (row.config ?? {}) as Record<string, unknown>,
    connectedById: row.connectedById,
    connectedAt: row.connectedAt,
  };
}

export class PrismaIntegrationRepository implements IntegrationRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}
  async listForOrg(orgId: string): Promise<IntegrationRecord[]> {
    // Stable order so "first connected" selection is deterministic + matches the in-memory wiring.
    const rows = await this.db.integration.findMany({ where: { orgId }, orderBy: { key: 'asc' } });
    return rows.map(toIntegrationRecord);
  }
  async findByKey(orgId: string, key: string): Promise<IntegrationRecord | null> {
    const row = await this.db.integration.findUnique({ where: { orgId_key: { orgId, key } } });
    return row ? toIntegrationRecord(row) : null;
  }
  async upsert(rec: IntegrationRecord): Promise<void> {
    const data = {
      orgId: rec.orgId,
      key: rec.key,
      group: rec.group,
      connected: rec.connected,
      secretRef: rec.secretRef,
      config: rec.config as Prisma.InputJsonValue,
      connectedById: rec.connectedById,
      connectedAt: rec.connectedAt,
    };
    await this.db.integration.upsert({
      where: { orgId_key: { orgId: rec.orgId, key: rec.key } },
      create: { id: rec.id, ...data },
      update: data,
    });
  }
}
