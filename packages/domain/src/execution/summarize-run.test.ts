import { describe, expect, it } from 'vitest';
import { summarizeRun } from './summarize-run';

describe('summarizeRun', () => {
  it('marks an all-pass run DONE with a 100% rate', () => {
    expect(summarizeRun(['PASS', 'PASS'])).toEqual({
      status: 'DONE',
      passed: 2,
      failed: 0,
      skipped: 0,
      total: 2,
      ratePct: 100,
    });
  });

  it('marks a run with any failure FAILED and rounds the pass rate', () => {
    expect(summarizeRun(['PASS', 'FAIL', 'SKIP'])).toEqual({
      status: 'FAILED',
      passed: 1,
      failed: 1,
      skipped: 1,
      total: 3,
      ratePct: 33,
    });
  });

  it('treats an all-skip run as DONE (no failures) with a 0% rate', () => {
    expect(summarizeRun(['SKIP', 'SKIP'])).toMatchObject({ status: 'DONE', passed: 0, skipped: 2, ratePct: 0 });
  });

  it('handles an empty result set as DONE with zero totals', () => {
    expect(summarizeRun([])).toEqual({
      status: 'DONE',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      ratePct: 0,
    });
  });
});
