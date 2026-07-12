import { useCallback, useEffect, useMemo, useState } from 'react';
import { summarizeAcrossRuns, summarizeByTool, type RunAggregateInput } from '@gilgamesh/domain';
import { EmptyState, ErrorState, Spinner } from '@gilgamesh/ui';
import type { RunResultView, RunSummaryView, RunsClient } from '../lib/runs-client';

export interface ReportsScreenProps {
  runsClient: RunsClient;
  projectId: string;
}

const toAggregate = (r: RunSummaryView): RunAggregateInput => ({
  passed: r.passed,
  failed: r.failed,
  skipped: r.skipped,
  total: r.total,
  durationMs: r.durationMs,
  createdAt: r.createdAt,
});

function formatDate(iso: string): string {
  // Deterministic, locale-independent: keep the ISO date + HH:MM (matches the capture's run label).
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function ReportsScreen({ runsClient, projectId }: ReportsScreenProps) {
  const [runs, setRuns] = useState<RunSummaryView[]>([]);
  const [results, setResults] = useState<RunResultView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A `useCallback` load (mirroring BillingScreen) so the error state can retry it. `isActive` restores
  // the pre-refactor safety guard: the mount effect passes `() => active` so a response arriving after
  // unmount / a mid-flight projectId change never sets state on a dead screen (review #1); retry calls
  // it with no arg (always active).
  //
  // ONE load window: `listRuns` (the run-health summaries, unchanged) then per-run `getRun` details for
  // the per-tool "Tools" breakdown — the only surface carrying the keystone-v0.7 per-result `tool` (the
  // list read is deliberately NOT widened). The detail fetch degrades gracefully: a failed run yields no
  // tool rows, never blanking the health card. Setting runs + results + loading together (not in a
  // trailing phase) keeps the getRun promises inside the guarded window (no state-after-unmount).
  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setError(null);
      setLoading(true);
      try {
        const data = await runsClient.listRuns(projectId);
        const details = await Promise.all(
          data.map((run) =>
            Promise.resolve()
              .then(() => runsClient.getRun(run.id))
              .then((rv) => rv.results)
              .catch(() => [] as RunResultView[]),
          ),
        );
        if (isActive()) {
          setRuns(data);
          setResults(details.flat());
        }
      } catch (err) {
        if (isActive()) setError(err instanceof Error ? err.message : 'Could not load runs.');
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [runsClient, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [projectId, load]);

  const summary = useMemo(() => summarizeAcrossRuns(runs.map(toAggregate)), [runs]);
  const barTotal = Math.max(summary.testsExecuted, 1);
  // Per-tool "Tools" breakdown (capture 08). The single source is the pure `summarizeByTool` fold —
  // the UI duplicates none of the arithmetic. Honesty: `tool` is emitted by the DeterministicKernel
  // stub until the real TOM kernel lands (same posture as every other kernel-backed number here).
  const byTool = useMemo(() => summarizeByTool(results), [results]);

  return (
    <section className="gx-report">
      <header className="gx-report__head">
        <h1 className="gx-room__title">Reports</h1>
        <p className="gx-room__sub">Test automation report — aggregated across every run in this project.</p>
      </header>

      {loading && <Spinner label="Loading reports…" />}

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {!error && !loading && runs.length === 0 && (
        <EmptyState title="No runs yet" hint="Trigger a run from the Test Lab to see reports here." />
      )}

      {!error && runs.length > 0 && (
        <>
          <div className="gx-report__stats">
            <article className="gx-report__health">
              <p className="gx-report__healthLabel">Overall run health</p>
              <p className="gx-report__healthRate">{summary.ratePct}%</p>
              <p className="gx-report__healthLine">
                {summary.passed} of {summary.testsExecuted} tests passed
              </p>
              <p className="gx-report__healthSub">
                Across {summary.runs} runs — {summary.failed} failures need triage, {summary.skipped} skipped
              </p>
              <div className="gx-report__bar" aria-hidden="true">
                <span className="gx-report__bar--pass" style={{ width: `${(summary.passed / barTotal) * 100}%` }} />
                <span className="gx-report__bar--fail" style={{ width: `${(summary.failed / barTotal) * 100}%` }} />
                <span className="gx-report__bar--skip" style={{ width: `${(summary.skipped / barTotal) * 100}%` }} />
              </div>
            </article>

            <article className="gx-report__stat" data-testid="stat-executed">
              <p className="gx-report__statLabel">Tests executed</p>
              <p className="gx-report__statValue">{summary.testsExecuted}</p>
            </article>
            <article className="gx-report__stat" data-testid="stat-passed">
              <p className="gx-report__statLabel">Passed</p>
              <p className="gx-report__statValue gx-report__statValue--pass">{summary.passed}</p>
            </article>
            <article className="gx-report__stat" data-testid="stat-failed">
              <p className="gx-report__statLabel">Failed</p>
              <p className="gx-report__statValue gx-report__statValue--fail">{summary.failed}</p>
            </article>
            <article className="gx-report__stat" data-testid="stat-skipped">
              <p className="gx-report__statLabel">Skipped</p>
              <p className="gx-report__statValue gx-report__statValue--skip">{summary.skipped}</p>
            </article>
          </div>

          {byTool.length > 0 && (
            <>
              <h2 className="gx-report__section">Tools</h2>
              <ul className="gx-report__tools" data-testid="tools-card">
                {byTool.map((t) => (
                  <li key={t.tool} className="gx-report__tool" data-testid={`tool-${t.tool}`}>
                    <span className="gx-report__toolName">{t.tool}</span>
                    <span className="gx-report__toolRate">{t.ratePct}%</span>
                    <span className="gx-report__toolCount gx-report__toolCount--pass">{t.passed} passed</span>
                    <span className="gx-report__toolCount gx-report__toolCount--fail">{t.failed} failed</span>
                    <span className="gx-report__toolCount gx-report__toolCount--skip">{t.skipped} skipped</span>
                    <span className="gx-report__toolTotal">{t.total} total</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="gx-report__section">Recent runs</h2>
          <ul className="gx-report__runs">
            {runs.map((r) => (
              <li key={r.id} className="gx-report__run">
                <span className="gx-report__runLabel">{r.runLabel ?? 'Run'}</span>
                <span className={`gx-report__runStatus gx-report__runStatus--${r.status.toLowerCase()}`}>
                  {r.status}
                </span>
                <span className="gx-report__runRate">{r.ratePct}%</span>
                <span className="gx-report__runCounts">
                  {r.passed}/{r.failed}/{r.skipped}
                </span>
                <span className="gx-report__runDuration">{formatDuration(r.durationMs)}</span>
                <span className="gx-report__runDate">{formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
