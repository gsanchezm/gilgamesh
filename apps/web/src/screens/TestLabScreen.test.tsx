import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunView, RunsClient } from '../lib/runs-client';
import type { TestLabClient } from '../lib/testlab-client';
import { TestLabScreen } from './TestLabScreen';

const aRun = (overrides?: Partial<RunView>): RunView => ({
  id: 'r1',
  projectId: 'p1',
  status: 'FAILED',
  targetKind: 'FEATURE',
  targetId: 'f1',
  runLabel: null,
  passed: 1,
  failed: 1,
  skipped: 0,
  total: 2,
  ratePct: 50,
  durationMs: 10,
  createdAt: '2026-06-30T00:00:00.000Z',
  results: [
    { refId: 'sc1', name: 'Pay', status: 'PASS', log: [] },
    { refId: 'sc2', name: 'Refund', status: 'FAIL', log: [] },
  ],
  ...overrides,
});

function fakeIntegrations() {
  return {
    list: vi.fn(async () => []),
    connect: vi.fn(async () => ({ key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: true, config: {}, connectedAt: null })),
    disconnect: vi.fn(async () => ({ key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: false, config: {}, connectedAt: null })),
    importRepo: vi.fn(async () => ({ imported: 2 })),
  };
}

function fakeRuns(overrides?: Partial<RunsClient>): RunsClient {
  return {
    triggerRun: vi.fn(async () => aRun()),
    listRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => aRun()),
    ...overrides,
  };
}

function fakeClient(overrides?: Partial<TestLabClient>): TestLabClient {
  return {
    listSlices: vi.fn(async () => [{ id: 's1', key: 'checkout', name: 'Checkout', order: 1 }]),
    createSlice: vi.fn(async (_p, input) => ({ id: 's2', key: input.key, name: input.name, order: 2 })),
    listFeatures: vi.fn(async () => []),
    getFeature: vi.fn(async () => ({ id: 'f1', name: 'F', path: 'f.feature', sliceId: null, content: '', scenarios: [] })),
    createFeature: vi.fn(async () => ({
      id: 'f1',
      name: 'Checkout',
      path: 'checkout.feature',
      sliceId: null,
      content: 'Feature: Checkout',
      scenarios: [
        { name: 'Pay', order: 0, lastStatus: null },
        { name: 'Refund', order: 1, lastStatus: null },
      ],
    })),
    listTestCases: vi.fn(async () => []),
    createTestCase: vi.fn(async (_p, input) => ({
      id: 't1',
      key: 'TC_PRJ_001',
      title: input.title,
      steps: '',
      data: '',
      expected: '',
      priority: input.priority,
      status: 'NOTRUN',
      sliceId: null,
      assignedAgentId: null,
    })),
    generate: vi.fn(async () => ({ features: [{ name: 'x', path: 'x', content: 'x' }], testCases: [] })),
    ...overrides,
  };
}

describe('TestLabScreen', () => {
  it('shows a spinner while the Test Lab loads (slice 37)', async () => {
    const client = fakeClient({ listSlices: vi.fn(() => new Promise<never>(() => {})) });
    render(<TestLabScreen client={client} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByText('Checkout')).toBeNull();
  });

  it('shows an error state with retry on load failure; retry re-invokes the load (slice 37)', async () => {
    const listSlices = vi
      .fn()
      .mockRejectedValueOnce(new Error('Lab boom'))
      .mockResolvedValueOnce([{ id: 's1', key: 'checkout', name: 'Checkout', order: 1 }]);
    render(
      <TestLabScreen client={fakeClient({ listSlices })} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Lab boom');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Checkout')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); // stale error cleared on the successful retry
    expect(listSlices).toHaveBeenCalledTimes(2);
  });

  it('shows an empty-state banner when the lab is empty, keeping the authoring forms reachable (slice 37)', async () => {
    // Empty lab: no slices, no features, no test cases.
    const client = fakeClient({ listSlices: vi.fn(async () => []) });
    render(<TestLabScreen client={client} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);

    expect(await screen.findByText('No tests authored yet')).toBeTruthy();
    // The empty state COEXISTS with the authoring forms — you must be able to add the first slice.
    expect(screen.getByRole('button', { name: 'Add slice' })).toBeTruthy();
    expect(screen.getByLabelText('Slice key')).toBeTruthy();
  });

  it('hides the empty-state banner when the lab has results (slice 37)', async () => {
    // Default fake client returns a Checkout slice — the banner must NOT appear.
    render(<TestLabScreen client={fakeClient()} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');
    expect(screen.queryByText('No tests authored yet')).toBeNull();
  });

  it('loads and renders slices, features and test cases', async () => {
    render(<TestLabScreen client={fakeClient()} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    expect(await screen.findByText('Checkout')).toBeTruthy();
    const summary = screen.getByRole('region', { name: 'Test Lab summary' });
    expect(summary).toBeTruthy();
  });

  it('adds a slice', async () => {
    const client = fakeClient();
    render(<TestLabScreen client={client} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Slice key'), { target: { value: 'regression' } });
    fireEvent.change(screen.getByLabelText('Slice name'), { target: { value: 'Regression' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add slice' }));

    await waitFor(() => expect(client.createSlice).toHaveBeenCalledWith('p1', { key: 'regression', name: 'Regression' }));
    expect(await screen.findByText('Regression')).toBeTruthy();
  });

  it('adds a feature and shows its parsed scenario count', async () => {
    render(<TestLabScreen client={fakeClient()} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Feature path'), { target: { value: 'checkout.feature' } });
    fireEvent.change(screen.getByLabelText('Feature content'), { target: { value: 'Feature: Checkout\n  Scenario: Pay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add feature' }));

    expect(await screen.findByText('Checkout · 2 scenarios')).toBeTruthy();
  });

  it('adds a test case', async () => {
    render(<TestLabScreen client={fakeClient()} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Test case title'), { target: { value: 'Pay with card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add test case' }));

    expect(await screen.findByText('TC_PRJ_001 · Pay with card · MEDIUM')).toBeTruthy();
  });

  it('generates drafts', async () => {
    render(<TestLabScreen client={fakeClient()} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a checkout flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText(/Generated 1 feature draft/)).toBeTruthy();
  });

  it('runs a feature and shows the aggregated result', async () => {
    const client = fakeClient({
      listFeatures: vi.fn(async () => [
        { id: 'f1', name: 'Checkout', path: 'c.feature', sliceId: null, scenarioCount: 2 },
      ]),
    });
    const runs = fakeRuns();
    render(<TestLabScreen client={client} runsClient={runs} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout · 2 scenarios');

    fireEvent.click(screen.getByRole('button', { name: 'Run feature Checkout' }));

    await waitFor(() =>
      expect(runs.triggerRun).toHaveBeenCalledWith('p1', { targetKind: 'FEATURE', targetId: 'f1' }),
    );
    expect(await screen.findByText(/Run FAILED — 1\/2 passed \(50%\)/)).toBeTruthy();
    expect(screen.getByText('Refund: FAIL')).toBeTruthy();
  });

  it('surfaces a creation error without crashing', async () => {
    const client = fakeClient({
      createSlice: vi.fn(async () => {
        throw new Error('A slice with key "checkout" already exists in this project.');
      }),
    });
    render(<TestLabScreen client={client} runsClient={fakeRuns()} integrationsClient={fakeIntegrations()} projectId="p1" />);
    await screen.findByText('Checkout');

    fireEvent.change(screen.getByLabelText('Slice key'), { target: { value: 'checkout' } });
    fireEvent.change(screen.getByLabelText('Slice name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add slice' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });
});
