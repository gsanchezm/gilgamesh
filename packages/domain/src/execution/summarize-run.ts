/**
 * Pure run-result aggregation (Clean Architecture — no framework imports). Folds a flat list of
 * per-scenario / per-test-case outcomes into the terminal {@link RunStatus} and the keystone `Run`
 * counts (passed/failed/skipped/total/ratePct). Used by the TriggerRun use case after the TestKernel
 * (stub now, chaos-proxy later) has produced its results.
 */
export type ResultStatus = 'PASS' | 'FAIL' | 'SKIP';

/** Terminal subset of the keystone RunStatus a synchronous run settles into. */
export type TerminalRunStatus = 'DONE' | 'FAILED';

export interface RunSummary {
  status: TerminalRunStatus;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  ratePct: number;
}

export function summarizeRun(results: readonly ResultStatus[]): RunSummary {
  const passed = results.filter((r) => r === 'PASS').length;
  const failed = results.filter((r) => r === 'FAIL').length;
  const skipped = results.filter((r) => r === 'SKIP').length;
  const total = results.length;
  return {
    status: failed > 0 ? 'FAILED' : 'DONE',
    passed,
    failed,
    skipped,
    total,
    ratePct: total === 0 ? 0 : Math.round((passed / total) * 100),
  };
}
