import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationsClient, IntegrationView } from '../lib/integrations-client';
import { IntegrationsScreen } from './IntegrationsScreen';

const catalog: IntegrationView[] = [
  { key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: false, config: {}, connectedAt: null },
  { key: 'gitlab', name: 'GitLab', group: 'SOURCE_REPOS', connected: true, config: {}, connectedAt: '2026-06-30T00:00:00.000Z' },
];

function fakeClient(overrides?: Partial<IntegrationsClient>): IntegrationsClient {
  return {
    list: vi.fn(async () => catalog),
    connect: vi.fn(async (_o, key) => ({ key, name: 'GitHub', group: 'SOURCE_REPOS', connected: true, config: {}, connectedAt: '2026-06-30T00:00:00.000Z' })),
    disconnect: vi.fn(async (_o, key) => ({ key, name: 'GitLab', group: 'SOURCE_REPOS', connected: false, config: {}, connectedAt: null })),
    importRepo: vi.fn(async () => ({ imported: 2 })),
    ...overrides,
  };
}

describe('IntegrationsScreen', () => {
  it('lists the catalog with connected state', async () => {
    render(<IntegrationsScreen client={fakeClient()} orgId="o1" />);
    expect(await screen.findByText('GitHub')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('connects GitHub with a token', async () => {
    const client = fakeClient();
    render(<IntegrationsScreen client={client} orgId="o1" />);
    await screen.findByText('GitHub');
    fireEvent.change(screen.getByLabelText('Token for GitHub'), { target: { value: 'ghp_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(client.connect).toHaveBeenCalledWith('o1', 'github', 'ghp_abc'));
  });

  it('disconnects GitLab', async () => {
    const client = fakeClient();
    render(<IntegrationsScreen client={client} orgId="o1" />);
    await screen.findByText('GitLab');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(client.disconnect).toHaveBeenCalledWith('o1', 'gitlab'));
  });
});
