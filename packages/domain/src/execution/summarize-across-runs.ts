/**
 * Pure project-level run aggregation (Clean Architecture — no framework imports). Folds a flat list
 * of per-run counts into one health summary for the Reports view: total tests executed, pass/fail/skip
 * sums, an overall pass rate, how many runs failed, total duration, and the most recent run timestamp.
 *
 * Complements {@link ./summarize-run.summarizeRun} (which folds a single run's per-scenario outcomes);
 * this one folds many runs' already-computed counts. Deterministic — `lastRunAt` is the maximum
 * `createdAt` by ISO-8601 string comparison, so it needs no wall-clock and stays framework-free.
 */
export interface RunAggregateInput {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  createdAt: string; // ISO-8601
}

export interface ProjectRunsSummary {
  runs: number;
  testsExecuted: number;
  passed: number;
  failed: number;
  skipped: number;
  ratePct: number; // passed / testsExecuted * 100, rounded to 1 decimal
  failingRuns: number;
  totalDurationMs: number;
  lastRunAt: string | null;
}

export function summarizeAcrossRuns(runs: readonly RunAggregateInput[]): ProjectRunsSummary {
  const passed = runs.reduce((sum, r) => sum + r.passed, 0);
  const failed = runs.reduce((sum, r) => sum + r.failed, 0);
  const skipped = runs.reduce((sum, r) => sum + r.skipped, 0);
  const testsExecuted = runs.reduce((sum, r) => sum + r.total, 0);
  const totalDurationMs = runs.reduce((sum, r) => sum + r.durationMs, 0);
  const failingRuns = runs.filter((r) => r.failed > 0).length;
  const lastRunAt = runs.reduce<string | null>(
    (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
    null,
  );
  return {
    runs: runs.length,
    testsExecuted,
    passed,
    failed,
    skipped,
    ratePct: testsExecuted === 0 ? 0 : Math.round((passed / testsExecuted) * 1000) / 10,
    failingRuns,
    totalDurationMs,
    lastRunAt,
  };
}
