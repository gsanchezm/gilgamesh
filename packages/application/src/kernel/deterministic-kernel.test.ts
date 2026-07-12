import { describe, expect, it } from 'vitest';
import type { RunEvent } from '../ports/kernel';
import { DeterministicKernel } from './deterministic-kernel';

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('DeterministicKernel', () => {
  it('derives PASS/FAIL/SKIP from scenario names and emits a DONE summary', async () => {
    const { runId, events } = new DeterministicKernel().run({
      runId: 'r1',
      target: {
        kind: 'FEATURE',
        featureId: 'f1',
        name: 'Checkout',
        scenarios: [
          { id: 's1', name: 'Pay with card' },
          { id: 's2', name: 'Payment fails on decline' },
          { id: 's3', name: 'Refund (wip)' },
        ],
      },
    });
    expect(runId).toBe('r1');

    const evs = await collect(events);
    const results = evs.filter((e) => e.type === 'RESULT') as Extract<RunEvent, { type: 'RESULT' }>[];
    expect(results.map((r) => [r.refId, r.status])).toEqual([
      ['s1', 'PASS'],
      ['s2', 'FAIL'],
      ['s3', 'SKIP'],
    ]);
    expect(evs.find((e) => e.type === 'DONE')).toMatchObject({ passed: 1, failed: 1, skipped: 1, total: 3 });
  });

  it('runs a single test case and is deterministic + offline (same plan -> same events)', async () => {
    const plan = {
      runId: 'r',
      target: { kind: 'TESTCASE' as const, testCaseId: 't1', name: 'Login works' },
    };
    const a = await collect(new DeterministicKernel().run(plan).events);
    const b = await collect(new DeterministicKernel().run(plan).events);
    expect(a).toEqual(b);
    expect(a.find((e) => e.type === 'RESULT')).toMatchObject({ refId: 't1', status: 'PASS' });
  });

  it('emits a deterministic tool + discipline on each RESULT (keystone v0.7)', async () => {
    const { events } = new DeterministicKernel().run({
      runId: 'r2',
      target: {
        kind: 'FEATURE',
        featureId: 'f2',
        name: 'Login',
        scenarios: [
          { id: 's1', name: 'user logs in' }, // default -> playwright / e2e
          { id: 's2', name: 'perf: load spike' }, // -> k6 / perf
          { id: 's3', name: 'security: xss probe' }, // -> zap / security
        ],
      },
    });
    const results = (await collect(events)).filter(
      (e) => e.type === 'RESULT',
    ) as Extract<RunEvent, { type: 'RESULT' }>[];
    expect(results.map((r) => r.tool)).toEqual(['playwright', 'k6', 'zap']);
    expect(results.map((r) => r.discipline)).toEqual(['e2e', 'perf', 'security']);
  });
});
