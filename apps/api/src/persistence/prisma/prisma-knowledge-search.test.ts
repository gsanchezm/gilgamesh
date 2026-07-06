import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaKnowledgeChunkRepository } from './prisma-repositories';

/**
 * Docker-free shape tests for the audit-#8 fix. Postgres will only drive the cosine search
 * through the HNSW index if the ANN scan's ORDER BY is the BARE distance expression — the old
 * `ORDER BY embedding <=> $q, id` tie-break forced a full sort (seq scan) and the index would
 * never be used. The fix nests an inner ANN scan (distance-only ORDER BY, oversampled LIMIT k*4)
 * under an outer deterministic re-sort (distance, then id) LIMIT k, preserving the exact
 * previous result semantics. Real recall/ordering runs under `test:int`; here we pin the shape.
 */

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

function repoCapturing(rows: unknown[] = []) {
  const captured: CapturedQuery[] = [];
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push({ sql: strings.join('?'), values });
    return rows;
  });
  const db = { $queryRaw } as unknown as Prisma.TransactionClient;
  return { repo: new PrismaKnowledgeChunkRepository(db), captured };
}

/** The ANN subquery's ORDER BY must be the bare distance expression (no tie-break column). */
function expectAnnShape(sql: string, k: number, values: unknown[]) {
  const flat = sql.replace(/\s+/g, ' ');
  // Inner ANN scan: ORDER BY embedding <=> $q::vector LIMIT — nothing (esp. no ", id")
  // between the distance expression and its LIMIT.
  expect(flat).toMatch(/ORDER BY embedding <=> \?::vector LIMIT \?/);
  // Outer deterministic re-sort, identical tie semantics to the previous exact scan.
  expect(flat).toMatch(/ORDER BY distance, id LIMIT \?/);
  // Oversample factor 4 on the inner scan; the outer keeps the requested k.
  expect(values).toContain(k * 4);
  expect(values).toContain(k);
}

describe('PrismaKnowledgeChunkRepository ANN query shape (audit #8)', () => {
  const embedding = [0.25, 0.5, 0.25];

  it('search: inner ANN scan without tie-break + outer (distance, id) re-sort', async () => {
    const { repo, captured } = repoCapturing();
    await repo.search(embedding, 5);

    expect(captured).toHaveLength(1);
    const { sql, values } = captured[0]!;
    expectAnnShape(sql, 5, values);
    // The shared-corpus filter stays inside the ANN scan.
    expect(sql).toContain('org_id IS NULL');
  });

  it('searchScoped: same ANN shape with the org/scope predicate inside the inner scan', async () => {
    const { repo, captured } = repoCapturing();
    await repo.searchScoped({ orgId: 'org-1', slot: 'perf' }, embedding, 8);

    expect(captured).toHaveLength(1);
    const { sql, values } = captured[0]!;
    expectAnnShape(sql, 8, values);
    expect(sql.replace(/\s+/g, ' ')).toContain('org_id IS NULL OR org_id = ?::uuid');
  });

  it('maps rows to ScoredChunk unchanged', async () => {
    const { repo } = repoCapturing([
      {
        id: 'c1',
        source: 'ISTQB',
        headingPath: ['Ch 1'],
        section: 'Intro',
        content: 'Testing shows the presence of defects.',
        tokenEstimate: 9,
        score: 0.87,
      },
    ]);
    const out = await repo.search(embedding, 5);
    expect(out).toEqual([
      {
        chunk: {
          id: 'c1',
          source: 'ISTQB',
          headingPath: ['Ch 1'],
          section: 'Intro',
          content: 'Testing shows the presence of defects.',
          embedding: [],
          tokenEstimate: 9,
        },
        score: 0.87,
      },
    ]);
  });
});
