import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResultStatus, RunResultView, RunSummaryView, RunView, RunsClient } from '../lib/runs-client';
import { ReportsScreen } from './ReportsScreen';

const summary = (over: Partial<RunSummaryView>): RunSummaryView => ({
  id: 'r-1',
  projectId: 'p-1',
  status: 'FAILED',
  targetKind: 'FEATURE',
  targetId: 't-1',
  runLabel: null,
  passed: 0,
  failed: 0,
  skipped: 0,
  total: 0,
  ratePct: 0,
  durationMs: 0,
  createdAt: '2026-05-25T19:00:00.000Z',
  ...over,
});

const result = (tool: string | null, status: ResultStatus, refId = `${tool}-${status}`): RunResultView => ({
  refId,
  name: refId,
  status,
  tool,
  discipline: null,
  log: [],
});

// A getRun that resolves each run to a RunView carrying per-result tools (the keystone-v0.7 dimension
// the Reports "Tools" card reads). The default fakeClient wires this so the tools card renders.
const runViewOf = (over: Partial<RunView>): RunView => ({ ...summary({}), results: [], ...over });

function fakeClient(overrides?: Partial<RunsClient>): RunsClient {
  // Flattened across both runs: playwright 2P/1F (66.7%), k6 1P/1S (50%), zap 1F (0%).
  const detail: Record<string, RunView> = {
    ra: runViewOf({
      id: 'ra',
      results: [result('playwright', 'PASS', 'pw-1'), result('playwright', 'PASS', 'pw-2'), result('playwright', 'FAIL', 'pw-3')],
    }),
    rb: runViewOf({ id: 'rb', results: [result('k6', 'PASS'), result('k6', 'SKIP'), result('zap', 'FAIL')] }),
  };
  return {
    triggerRun: vi.fn(),
    listRuns: vi.fn(async () => [
      summary({ id: 'ra', runLabel: 'nightly', passed: 100, failed: 20, total: 120, durationMs: 1000, createdAt: '2026-05-24T10:00:00.000Z' }),
      summary({ id: 'rb', runLabel: 'local', passed: 25, failed: 7, total: 32, durationMs: 500, createdAt: '2026-05-25T19:00:00.000Z' }),
    ]),
    getRun: vi.fn(async (id: string) => detail[id] ?? runViewOf({ id })),
    ...overrides,
  };
}

function renderScreen(client: RunsClient) {
  return render(<ReportsScreen runsClient={client} projectId="p-1" />);
}

describe('ReportsScreen', () => {
  it('loads the project runs on mount exactly once', async () => {
    const client = fakeClient();
    renderScreen(client);
    await waitFor(() => expect(client.listRuns).toHaveBeenCalledWith('p-1'));
    await screen.findByText('nightly');
    // A mis-keyed load callback would double-fire the fetch.
    expect(client.listRuns).toHaveBeenCalledTimes(1);
  });

  it('shows the async Spinner (role=status) while the runs are loading', async () => {
    renderScreen(fakeClient());
    // The load is in flight on first paint — the spinner is announced to assistive tech.
    expect(screen.getByRole('status', { name: /loading/i })).toBeTruthy();
    // Let the load settle so the assertion above ran during the real loading window.
    await screen.findByText('nightly');
  });

  it('renders the overall run health aggregated across runs', async () => {
    renderScreen(fakeClient());
    expect(await screen.findByText('82.2%')).toBeTruthy();
    expect(screen.getByText('125 of 152 tests passed')).toBeTruthy();
    expect(screen.getByText(/Across 2 runs — 27 failures need triage, 0 skipped/)).toBeTruthy();
  });

  it('renders the four stat cards with the aggregated counts', async () => {
    renderScreen(fakeClient());
    await screen.findByText('82.2%');
    expect(within(screen.getByTestId('stat-executed')).getByText('152')).toBeTruthy();
    expect(within(screen.getByTestId('stat-passed')).getByText('125')).toBeTruthy();
    expect(within(screen.getByTestId('stat-failed')).getByText('27')).toBeTruthy();
    expect(within(screen.getByTestId('stat-skipped')).getByText('0')).toBeTruthy();
  });

  it('lists the recent runs (read-only)', async () => {
    renderScreen(fakeClient());
    expect(await screen.findByText('nightly')).toBeTruthy();
    expect(screen.getByText('local')).toBeTruthy();
  });

  it('renders the per-tool "Tools" card grouping every run\'s results by executing tool (AC-REPORT-TOOL-01/02)', async () => {
    renderScreen(fakeClient());
    // The tools card only appears once the per-run details (getRun) resolve carrying tools.
    const card = await screen.findByTestId('tools-card');

    // playwright: 2 passed / 1 failed of 3 total -> a 1-DECIMAL rate (66.7), the crux the aggregate proof needs.
    const pw = within(screen.getByTestId('tool-playwright'));
    expect(pw.getByText('66.7%')).toBeTruthy();
    expect(pw.getByText('2 passed')).toBeTruthy();
    expect(pw.getByText('1 failed')).toBeTruthy();
    expect(pw.getByText('0 skipped')).toBeTruthy();
    expect(pw.getByText('3 total')).toBeTruthy();

    // k6: 1 passed / 1 skipped across the two runs (skip counts in the denominator) -> 50%.
    const k6 = within(screen.getByTestId('tool-k6'));
    expect(k6.getByText('50%')).toBeTruthy();
    expect(k6.getByText('1 passed')).toBeTruthy();
    expect(k6.getByText('1 skipped')).toBeTruthy();

    // zap: a single failure -> 0%.
    expect(within(screen.getByTestId('tool-zap')).getByText('0%')).toBeTruthy();

    // Deterministic order: most-executed first (playwright 3), then k6 (2), then zap (1).
    const rows = within(card).getAllByTestId(/^tool-/);
    expect(rows.map((el) => el.getAttribute('data-testid'))).toEqual(['tool-playwright', 'tool-k6', 'tool-zap']);
  });

  it('degrades gracefully — a failed per-run detail fetch omits the Tools card but keeps the health card', async () => {
    // If getRun rejects for every run, the tools breakdown has no data; the primary report still renders.
    const client = fakeClient({ getRun: vi.fn(async () => { throw new Error('boom'); }) });
    renderScreen(client);
    expect(await screen.findByText('82.2%')).toBeTruthy(); // health card unaffected
    expect(screen.queryByTestId('tools-card')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull(); // a detail failure is not a screen error
  });

  it('shows the EmptyState when the project has no runs', async () => {
    renderScreen(fakeClient({ listRuns: vi.fn(async () => []) }));
    expect(await screen.findByText(/No runs yet/i)).toBeTruthy();
    // The empty state is static content, not an alert/status live region.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the ErrorState (role=alert) when the runs cannot be loaded', async () => {
    const client = fakeClient({
      listRuns: vi.fn(async () => {
        throw new Error('Could not load runs.');
      }),
    });
    renderScreen(client);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load runs.');
  });

  it('retries the fetch when the ErrorState retry action is clicked', async () => {
    const listRuns = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not load runs.'))
      .mockResolvedValueOnce([summary({ id: 'ra', runLabel: 'nightly', passed: 1, total: 1 })]);
    renderScreen(fakeClient({ listRuns }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load runs.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('nightly')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listRuns).toHaveBeenCalledTimes(2);
  });
});
