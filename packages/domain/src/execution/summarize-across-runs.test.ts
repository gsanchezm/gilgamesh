import { describe, expect, it } from 'vitest';
import { summarizeAcrossRuns, type RunAggregateInput } from './summarize-across-runs';

const run = (over: Partial<RunAggregateInput> = {}): RunAggregateInput => ({
  passed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  durationMs: 0,
  createdAt: '2026-05-25T19:00:00.000Z',
  ...over,
});

describe('summarizeAcrossRuns', () => {
  it('folds an empty list to zeros with a null lastRunAt', () => {
    expect(summarizeAcrossRuns([])).toEqual({
      runs: 0,
      testsExecuted: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      ratePct: 0,
      failingRuns: 0,
      totalDurationMs: 0,
      lastRunAt: null,
    });
  });

  it('passes a single run through with its own counts', () => {
    expect(
      summarizeAcrossRuns([run({ passed: 8, failed: 1, skipped: 1, total: 10, durationMs: 500 })]),
    ).toMatchObject({
      runs: 1,
      testsExecuted: 10,
      passed: 8,
      failed: 1,
      skipped: 1,
      failingRuns: 1,
      totalDurationMs: 500,
    });
  });

  it('sums counts and durations across runs', () => {
    const summary = summarizeAcrossRuns([
      run({ passed: 4, failed: 0, skipped: 0, total: 4, durationMs: 200 }),
      run({ passed: 3, failed: 2, skipped: 1, total: 6, durationMs: 300 }),
    ]);
    expect(summary).toMatchObject({
      runs: 2,
      testsExecuted: 10,
      passed: 7,
      failed: 2,
      skipped: 1,
      totalDurationMs: 500,
    });
  });

  it('carries the pass rate to one decimal (125 of 152 -> 82.2%)', () => {
    expect(summarizeAcrossRuns([run({ passed: 125, failed: 27, total: 152 })]).ratePct).toBe(82.2);
  });

  it('reports a 0% rate when no tests were executed', () => {
    expect(summarizeAcrossRuns([run({ total: 0 }), run({ total: 0 })]).ratePct).toBe(0);
  });

  it('counts only runs with at least one failure as failing runs', () => {
    const summary = summarizeAcrossRuns([
      run({ passed: 5, total: 5 }),
      run({ passed: 2, failed: 3, total: 5 }),
      run({ passed: 4, failed: 1, total: 5 }),
    ]);
    expect(summary.failingRuns).toBe(2);
  });

  it('selects the latest createdAt as lastRunAt regardless of input order', () => {
    const summary = summarizeAcrossRuns([
      run({ createdAt: '2026-05-25T10:00:00.000Z' }),
      run({ createdAt: '2026-05-26T09:00:00.000Z' }),
      run({ createdAt: '2026-05-25T23:00:00.000Z' }),
    ]);
    expect(summary.lastRunAt).toBe('2026-05-26T09:00:00.000Z');
  });
});
