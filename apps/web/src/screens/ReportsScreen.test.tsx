import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunSummaryView, RunsClient } from '../lib/runs-client';
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

function fakeClient(overrides?: Partial<RunsClient>): RunsClient {
  return {
    triggerRun: vi.fn(),
    listRuns: vi.fn(async () => [
      summary({ id: 'ra', runLabel: 'nightly', passed: 100, failed: 20, total: 120, durationMs: 1000, createdAt: '2026-05-24T10:00:00.000Z' }),
      summary({ id: 'rb', runLabel: 'local', passed: 25, failed: 7, total: 32, durationMs: 500, createdAt: '2026-05-25T19:00:00.000Z' }),
    ]),
    getRun: vi.fn(),
    ...overrides,
  };
}

function renderScreen(client: RunsClient) {
  return render(<ReportsScreen runsClient={client} projectId="p-1" />);
}

describe('ReportsScreen', () => {
  it('loads the project runs on mount', async () => {
    const client = fakeClient();
    renderScreen(client);
    await waitFor(() => expect(client.listRuns).toHaveBeenCalledWith('p-1'));
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

  it('shows an empty state when the project has no runs', async () => {
    renderScreen(fakeClient({ listRuns: vi.fn(async () => []) }));
    expect(await screen.findByText(/No runs yet/i)).toBeTruthy();
  });

  it('shows an error when the runs cannot be loaded', async () => {
    const client = fakeClient({
      listRuns: vi.fn(async () => {
        throw new Error('Could not load runs.');
      }),
    });
    renderScreen(client);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load runs.');
  });
});
