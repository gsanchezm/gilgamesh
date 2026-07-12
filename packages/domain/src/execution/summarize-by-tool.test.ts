import { describe, expect, it } from 'vitest';
import type { ResultStatus } from './summarize-run';
import { summarizeByTool, UNKNOWN_TOOL, type ToolSummaryInput } from './summarize-by-tool';

const r = (tool: string | null | undefined, status: ResultStatus): ToolSummaryInput => ({ tool, status });

describe('summarizeByTool', () => {
  it('folds an empty list to an empty array', () => {
    expect(summarizeByTool([])).toEqual([]);
  });

  it('groups results by tool with pass/fail/skip counts and a total', () => {
    const out = summarizeByTool([
      r('playwright', 'PASS'),
      r('playwright', 'FAIL'),
      r('k6', 'PASS'),
      r('k6', 'SKIP'),
    ]);
    expect(out).toEqual([
      { tool: 'k6', passed: 1, failed: 0, skipped: 1, total: 2, ratePct: 50 },
      { tool: 'playwright', passed: 1, failed: 1, skipped: 0, total: 2, ratePct: 50 },
    ]);
  });

  it('carries the per-tool pass rate to one decimal (2 of 3 -> 66.7, not 67)', () => {
    // Mirrors summarizeAcrossRuns (1-decimal), NOT the integer summarizeRun.
    const out = summarizeByTool([r('playwright', 'PASS'), r('playwright', 'PASS'), r('playwright', 'FAIL')]);
    expect(out).toEqual([{ tool: 'playwright', passed: 2, failed: 1, skipped: 0, total: 3, ratePct: 66.7 }]);
  });

  it('counts skips in the pass-rate denominator (2 passed of 3 total incl. a skip -> 66.7)', () => {
    const out = summarizeByTool([r('k6', 'PASS'), r('k6', 'PASS'), r('k6', 'SKIP')]);
    expect(out[0]).toEqual({ tool: 'k6', passed: 2, failed: 0, skipped: 1, total: 3, ratePct: 66.7 });
  });

  it('reports a 0% rate for a tool with no results counted as passed', () => {
    const out = summarizeByTool([r('zap', 'FAIL'), r('zap', 'SKIP')]);
    expect(out[0]).toMatchObject({ tool: 'zap', passed: 0, total: 2, ratePct: 0 });
  });

  it('orders by total descending, tool name ascending as the tiebreak', () => {
    const out = summarizeByTool([
      // playwright: 3 total, vitest: 1 total, k6: 2 total, zap: 2 total
      r('playwright', 'PASS'),
      r('playwright', 'PASS'),
      r('playwright', 'FAIL'),
      r('vitest', 'PASS'),
      r('zap', 'PASS'),
      r('zap', 'FAIL'),
      r('k6', 'PASS'),
      r('k6', 'PASS'),
    ]);
    // playwright (3) first; then the two 2-total tools by name asc (k6 < zap); then vitest (1).
    expect(out.map((t) => t.tool)).toEqual(['playwright', 'k6', 'zap', 'vitest']);
  });

  it('routes a null / absent / blank tool into the deterministic "unknown" bucket', () => {
    expect(UNKNOWN_TOOL).toBe('unknown');
    const out = summarizeByTool([r(null, 'PASS'), r(undefined, 'FAIL'), r('   ', 'SKIP'), r('playwright', 'PASS')]);
    const unknown = out.find((t) => t.tool === 'unknown');
    expect(unknown).toEqual({ tool: 'unknown', passed: 1, failed: 1, skipped: 1, total: 3, ratePct: 33.3 });
  });

  it('is deterministic regardless of input order', () => {
    const a = summarizeByTool([r('k6', 'PASS'), r('playwright', 'FAIL'), r('k6', 'SKIP')]);
    const b = summarizeByTool([r('playwright', 'FAIL'), r('k6', 'SKIP'), r('k6', 'PASS')]);
    expect(a).toEqual(b);
  });
});
