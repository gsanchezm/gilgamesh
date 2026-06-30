import { describe, expect, it } from 'vitest';
import type { FeatureRecord, RunRecord, TestCaseRecord } from '../ports/records';
import {
  InMemoryFeatureRepository,
  InMemoryRunRepository,
  InMemoryTestCaseRepository,
} from './in-memory';

/**
 * The in-memory adapters must list rows in the *same* deterministic order as their Prisma
 * counterparts (audit #8), otherwise the Docker-free unit/e2e suites would pass on an ordering the
 * real database never produces. These lock the parity:
 *   - features:   createdAt asc, id asc
 *   - test cases: key asc
 *   - runs:       createdAt desc, id desc
 */

function feature(id: string, createdAt: Date): FeatureRecord {
  return {
    id,
    orgId: 'org',
    projectId: 'p1',
    sliceId: null,
    name: id,
    path: `${id}.feature`,
    content: '',
    createdAt,
    updatedAt: createdAt,
  };
}

function testCase(id: string, key: string): TestCaseRecord {
  return {
    id,
    orgId: 'org',
    projectId: 'p1',
    sliceId: null,
    key,
    title: id,
    steps: '',
    data: '',
    expected: '',
    priority: 'MEDIUM',
    status: 'NOTRUN',
    assignedAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function run(id: string, createdAt: Date): RunRecord {
  return {
    id,
    orgId: 'org',
    projectId: 'p1',
    status: 'DONE',
    trigger: 'MANUAL',
    targetKind: 'FEATURE',
    targetId: 't',
    runLabel: null,
    passed: 1,
    failed: 0,
    skipped: 0,
    total: 1,
    ratePct: 100,
    durationMs: 1,
    createdById: 'u',
    startedAt: createdAt,
    finishedAt: createdAt,
    createdAt,
  };
}

describe('in-memory adapter ordering parity', () => {
  it('lists features createdAt asc, id asc — independent of insertion order', async () => {
    const repo = new InMemoryFeatureRepository();
    // Insert newest-first and out of id order; expect createdAt asc, then id asc on ties.
    await repo.create(feature('b', new Date(2000)));
    await repo.create(feature('a', new Date(1000)));
    await repo.create(feature('c', new Date(1000)));
    expect((await repo.listForProject('p1')).map((f) => f.id)).toEqual(['a', 'c', 'b']);
  });

  it('lists test cases by key asc — independent of insertion order', async () => {
    const repo = new InMemoryTestCaseRepository();
    await repo.create(testCase('x', 'TC_PRJ_003'));
    await repo.create(testCase('y', 'TC_PRJ_001'));
    await repo.create(testCase('z', 'TC_PRJ_002'));
    expect((await repo.listForProject('p1')).map((t) => t.key)).toEqual([
      'TC_PRJ_001',
      'TC_PRJ_002',
      'TC_PRJ_003',
    ]);
  });

  it('lists runs createdAt desc, id desc — newest first', async () => {
    const repo = new InMemoryRunRepository();
    await repo.create(run('a', new Date(1000)));
    await repo.create(run('b', new Date(3000)));
    await repo.create(run('c', new Date(1000)));
    // 'b' newest; 'a' and 'c' share createdAt → id desc → 'c' before 'a'.
    expect((await repo.listForProject('p1')).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});
