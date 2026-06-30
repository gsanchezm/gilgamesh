import { type AgentBrainPort, IngestKnowledge, type KnowledgeChunkRepository, SearchKnowledge } from '@gilgamesh/application';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { TOKENS } from '../../src/persistence/tokens';

let app: INestApplication;
let db: PrismaService;
let knowledge: KnowledgeChunkRepository;
let brain: AgentBrainPort;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [PrismaPersistenceModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  db = app.get(PrismaService);
  knowledge = app.get(TOKENS.Knowledge);
  brain = app.get(TOKENS.Brain);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE knowledge_chunks CASCADE');
});

/**
 * Validates the pgvector adapter against real Postgres: the Unsupported vector column is written via raw SQL
 * (array binding for heading_path + ::vector cast) and the cosine `<=>` search ranks by lexical overlap.
 */
describe('Knowledge / RAG (Prisma · real Postgres + pgvector)', () => {
  it('ingests into the vector column and ranks search by cosine similarity', async () => {
    await new IngestKnowledge({ knowledge, brain }).execute([
      {
        id: 'k1',
        source: 'bddbooks-discovery',
        headingPath: ['Discovery', 'Example Mapping'],
        section: 'Example Mapping',
        text: 'Example mapping uses coloured cards for rules and concrete examples during collaborative discovery.',
      },
      {
        id: 'k2',
        source: 'ISTQB-CT-PT',
        headingPath: ['Performance'],
        section: 'Load testing',
        text: 'Performance testing measures throughput and latency under heavy load sustained over time.',
      },
    ]);

    expect(await knowledge.count()).toBe(2);

    const res = await new SearchKnowledge({ knowledge, brain }).execute({ query: 'example mapping cards rules', k: 2 });
    expect(res.total).toBe(2);
    expect(res.results[0]!.citation).toMatchObject({ source: 'bddbooks-discovery', section: 'Example Mapping' });
    expect(res.results[0]!.citation.headingPath).toEqual(['Discovery', 'Example Mapping']);
    expect(res.results[0]!.score).toBeGreaterThan(res.results[1]!.score);
  });

  it('breaks pgvector cosine ties deterministically by id (AC-KB-05 parity with in-memory)', async () => {
    // identical text -> identical vector -> exact cosine tie -> the `ORDER BY … , id` tiebreak decides.
    await new IngestKnowledge({ knowledge, brain }).execute([
      { id: 'tie-b', source: 'B', headingPath: [], section: '', text: 'identical reference text about testing techniques' },
      { id: 'tie-a', source: 'A', headingPath: [], section: '', text: 'identical reference text about testing techniques' },
    ]);
    const first = await new SearchKnowledge({ knowledge, brain }).execute({ query: 'testing techniques reference', k: 2 });
    const second = await new SearchKnowledge({ knowledge, brain }).execute({ query: 'testing techniques reference', k: 2 });
    expect(first.results.map((r) => r.citation.source)).toEqual(['A', 'B']);
    expect(second.results.map((r) => r.citation.source)).toEqual(first.results.map((r) => r.citation.source));
  });

  it('returns empty for a tokenless query (zero vector), never NaN scores', async () => {
    await new IngestKnowledge({ knowledge, brain }).execute([
      { id: 'z1', source: 's', headingPath: [], section: '', text: 'equivalence partitioning divides the input domain' },
    ]);
    const res = await new SearchKnowledge({ knowledge, brain }).execute({ query: '!!! ??? —' });
    expect(res.results).toEqual([]);
  });

  it('upsert is idempotent on chunk id (re-ingest updates, not duplicates)', async () => {
    const ingest = new IngestKnowledge({ knowledge, brain });
    const chunk = { id: 'k1', source: 's', headingPath: ['H'], section: 'S', text: 'equivalence partitioning divides the input domain into classes' };
    await ingest.execute([chunk]);
    await ingest.execute([{ ...chunk, text: 'boundary value analysis tests the edges of partitions' }]);
    expect(await knowledge.count()).toBe(1);
    const res = await new SearchKnowledge({ knowledge, brain }).execute({ query: 'boundary value edges' });
    expect(res.results[0]!.content).toContain('boundary value');
  });
});
