/**
 * Pure per-tool run aggregation (Clean Architecture — no framework imports). Folds a flat list of
 * per-scenario / per-test-case outcomes into one health row **per executing tool** for the Reports
 * "Tools" card (capture 08): passed/failed/skipped counts, a total, and a 1-decimal pass rate.
 *
 * The `tool` dimension comes from the keystone-v0.7 `RunResult.tool` field, populated deterministically
 * by the `DeterministicKernel` stub today (the real TOM/chaos-proxy kernel emits genuine values later),
 * so the breakdown is honestly stub-derived — identical posture to every other kernel-backed number.
 *
 * Complements {@link ./summarize-run.summarizeRun} (one run's terminal status) and
 * {@link ./summarize-across-runs.summarizeAcrossRuns} (a project's run-health roll-up); this one is the
 * single source of the per-tool numbers so the UI duplicates none of the arithmetic. Deterministic:
 * a null/absent/blank tool falls into the {@link UNKNOWN_TOOL} bucket and the rows are ordered by total
 * descending with the tool name as a stable tiebreak, so identical inputs (in any order) yield an
 * identical result.
 */
import type { ResultStatus } from './summarize-run';

/** Deterministic bucket for a result whose executing tool is null / absent / blank. */
export const UNKNOWN_TOOL = 'unknown';

export interface ToolSummaryInput {
  tool?: string | null;
  status: ResultStatus;
}

export interface ToolSummary {
  tool: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  /** passed / total * 100, rounded to 1 decimal (mirrors summarizeAcrossRuns, not integer summarizeRun). */
  ratePct: number;
}

export function summarizeByTool(results: readonly ToolSummaryInput[]): ToolSummary[] {
  const byTool = new Map<string, ToolSummary>();
  for (const r of results) {
    const tool = r.tool && r.tool.trim() !== '' ? r.tool : UNKNOWN_TOOL;
    let s = byTool.get(tool);
    if (!s) {
      s = { tool, passed: 0, failed: 0, skipped: 0, total: 0, ratePct: 0 };
      byTool.set(tool, s);
    }
    if (r.status === 'PASS') s.passed += 1;
    else if (r.status === 'FAIL') s.failed += 1;
    else s.skipped += 1;
    s.total += 1;
  }

  const out = [...byTool.values()].map((s) => ({
    ...s,
    ratePct: s.total === 0 ? 0 : Math.round((s.passed / s.total) * 1000) / 10,
  }));
  // Deterministic order: most-executed tool first, tool name ascending as the stable tiebreak.
  out.sort((a, b) => b.total - a.total || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
  return out;
}
