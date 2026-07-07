import { useCallback, useEffect, useMemo, useState } from 'react';
import { summarizeAcrossRuns, type RunAggregateInput } from '@gilgamesh/domain';
import { EmptyState, ErrorState, Spinner } from '@gilgamesh/ui';
import type { RunSummaryView, RunsClient } from '../lib/runs-client';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A `useCallback` load (mirroring BillingScreen) so the error state can retry it. Same data path
  // as before — `runsClient.listRuns` — under the same loading/error gates. `isActive` restores the
  // pre-refactor safety guard: the mount effect passes `() => active` so a response arriving after
  // unmount / a mid-flight projectId change never sets state on a dead screen (review #1); retry
  // calls it with no arg (always active).
  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setError(null);
      setLoading(true);
      try {
        const data = await runsClient.listRuns(projectId);
        if (isActive()) setRuns(data);
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
