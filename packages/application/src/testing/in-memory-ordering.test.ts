import { describe, expect, it } from 'vitest';
import type { ChatMessageRecord, ChatSessionRecord, FeatureRecord, RunRecord, TestCaseRecord } from '../ports/records';
import {
  InMemoryChatMessageRepository,
  InMemoryChatSessionRepository,
  InMemoryFeatureRepository,
  InMemoryRunRepository,
  InMemoryTestCaseRepository,
} from './in-memory';

/**
 * The in-memory adapters must list rows in the *same* deterministic order as their Prisma
 * counterparts (audit #8), otherwise the Docker-free unit/e2e suites would pass on an ordering the
 * real database never produces. These lock the parity:
 *   - features:      createdAt asc, id asc
 *   - test cases:    key asc
 *   - runs:          createdAt desc, id desc
 *   - chat sessions: updatedAt desc, id desc (slice 11 — the session rail's newest-first)
 *   - first USER message per session: createdAt asc, id asc (slice 11 — derived titles, batched)
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

  it('lists chat sessions updatedAt desc, id desc — newest activity first', async () => {
    const repo = new InMemoryChatSessionRepository();
    await repo.create(session('a', new Date(1000)));
    await repo.create(session('b', new Date(3000)));
    await repo.create(session('c', new Date(1000)));
    // 'b' most recently active; 'a' and 'c' tie on updatedAt → id desc → 'c' before 'a'.
    expect((await repo.listForProject('p1')).map((s) => s.id)).toEqual(['b', 'c', 'a']);

    // touch (the S8 send bump) reorders: 'a' becomes the newest.
    await repo.touch('a', new Date(5000));
    expect((await repo.listForProject('p1')).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolves the FIRST USER message per session in one batched call (createdAt asc, id asc ties)', async () => {
    const repo = new InMemoryChatMessageRepository();
    await repo.create(message('m4', 's2', 'USER', new Date(4000)));
    await repo.create(message('m1', 's1', 'AGENT', new Date(1000))); // not USER — never a title
    await repo.create(message('m3', 's1', 'USER', new Date(2000))); // same ms as m2 → id asc → m2 wins
    await repo.create(message('m2', 's1', 'USER', new Date(2000)));

    const firsts = await repo.firstUserMessageBySession(['s1', 's2', 's3']);
    expect(new Map(firsts.map((m) => [m.sessionId, m.id]))).toEqual(
      new Map([
        ['s1', 'm2'],
        ['s2', 'm4'],
        // 's3' has no USER message → absent
      ]),
    );
  });
});

function session(id: string, updatedAt: Date): ChatSessionRecord {
  return {
    id,
    orgId: 'org',
    projectId: 'p1',
    agentId: null,
    createdById: 'u',
    createdAt: updatedAt,
    updatedAt,
  };
}

function message(id: string, sessionId: string, role: ChatMessageRecord['role'], createdAt: Date): ChatMessageRecord {
  return { id, orgId: 'org', sessionId, role, agentId: null, content: `${id} content`, runId: null, createdAt };
}
