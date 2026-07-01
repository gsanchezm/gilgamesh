import {
  DeterministicBrain,
  type KnowledgeChunkRepository,
  type Repositories,
  type UnitOfWork,
  UploadKnowledgeDocument,
} from '@gilgamesh/application';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock, Uuid7IdGenerator } from '../../src/infra';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import {
  PrismaKnowledgeChunkRepository,
  PrismaMembershipRepository,
} from '../../src/persistence/prisma/prisma-repositories';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../src/persistence/prisma/prisma-unit-of-work';

let app: INestApplication;
let db: PrismaService;

const ids = new Uuid7IdGenerator();
const clock = new SystemClock();
const brain = new DeterministicBrain();

const MD = '# Test Design\n\nBoundary value analysis picks the edges of each equivalence class.';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [PrismaPersistenceModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  db = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE orgs, users, memberships, knowledge_documents, knowledge_chunks CASCADE',
  );
});

/** Seeds a minimal tenant (org + user + membership) so the upload gate passes. */
async function seedTenant(): Promise<{ orgId: string; userId: string }> {
  const now = clock.now();
  const orgId = ids.next();
  const userId = ids.next();
  await db.org.create({
    data: { id: orgId, name: 'Uruk QA', slug: `uruk-${orgId.slice(0, 8)}`, createdAt: now, updatedAt: now },
  });
  await db.user.create({
    data: {
      id: userId,
      email: `u-${userId.slice(0, 8)}@uruk.io`,
      passwordHash: '$argon2id$dummy',
      firstName: 'Gil',
      middleName: null,
      lastName: 'Uruk',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.membership.create({ data: { id: ids.next(), orgId, userId, role: 'MEMBER', createdAt: now } });
  return { orgId, userId };
}

async function countChunks(documentId?: string): Promise<number> {
  const rows = documentId
    ? await db.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM knowledge_chunks WHERE document_id = ${documentId}::uuid`
    : await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM knowledge_chunks`;
  return rows[0]!.count;
}

/**
 * Upload must be all-or-nothing (audit #1) AND the schema must keep chunks referentially tied to their
 * document (audit #2). Exercised against real Postgres: transactional rollback + the document_id FK.
 */
describe('Knowledge document upload (Prisma · real Postgres) — atomicity + FK integrity', () => {
  it('is atomic: a chunk-write failure rolls back the document too (no orphaned rows)', async () => {
    const { orgId, userId } = await seedTenant();

    // Real Prisma transaction, but the chunk write throws AFTER the document row was inserted in-tx.
    const prismaUow = new PrismaUnitOfWork(db);
    const memberships = new PrismaMembershipRepository(db);
    const faultyUow: UnitOfWork = {
      transaction: (work) =>
        prismaUow.transaction((repos) => {
          const knowledge: KnowledgeChunkRepository = {
            upsertMany: async () => {
              throw new Error('boom: chunk write failed');
            },
            search: (q, k) => repos.knowledge.search(q, k),
            count: () => repos.knowledge.count(),
          };
          return work({ ...repos, knowledge } as Repositories);
        }),
    };

    const upload = new UploadKnowledgeDocument({ uow: faultyUow, brain, memberships, ids, clock });
    await expect(
      upload.execute({ orgId, userId, name: 'design.md', type: 'md', content: MD }),
    ).rejects.toThrow(/boom/);

    // Neither the document nor any chunk survives — the whole transaction rolled back.
    expect(await db.knowledgeDocument.count()).toBe(0);
    expect(await countChunks()).toBe(0);
  });

  it('rejects a chunk whose document_id references no document (FK enforced)', async () => {
    const { orgId } = await seedTenant();
    const [embedding] = await brain.embed(['boundary value analysis']);
    const chunks = new PrismaKnowledgeChunkRepository(db);

    await expect(
      chunks.upsertMany([
        {
          id: ids.next(),
          orgId,
          documentId: ids.next(), // no such knowledge_documents row
          source: 'x',
          headingPath: [],
          section: 's',
          content: 'c',
          embedding: embedding!,
          tokenEstimate: 1,
        },
      ]),
    ).rejects.toThrow();
  });

  it('cascades: deleting a document removes its chunks', async () => {
    const { orgId, userId } = await seedTenant();
    const upload = new UploadKnowledgeDocument({
      uow: new PrismaUnitOfWork(db),
      brain,
      memberships: new PrismaMembershipRepository(db),
      ids,
      clock,
    });

    const doc = await upload.execute({ orgId, userId, name: 'design.md', type: 'md', content: MD });
    expect(await countChunks(doc.id)).toBeGreaterThan(0);

    await db.knowledgeDocument.delete({ where: { id: doc.id } });
    expect(await countChunks(doc.id)).toBe(0);
  });
});
