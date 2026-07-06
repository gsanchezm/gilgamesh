import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/** Row-scoped queries (the Playwright `githubRow` pattern): each card is a listitem whose
 *  accessible name is the integration name (aria-label) — no positional button indexing. */
function card(name: string) {
  return within(screen.getByRole('listitem', { name }));
}
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationsClient, IntegrationView } from '../lib/integrations-client';
import { IntegrationsScreen } from './IntegrationsScreen';

const catalog: IntegrationView[] = [
  { key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: false, config: {}, connectedAt: null },
  { key: 'gitlab', name: 'GitLab', group: 'SOURCE_REPOS', connected: true, config: {}, connectedAt: '2026-06-30T00:00:00.000Z' },
  { key: 'anthropic', name: 'Anthropic (Claude)', group: 'AI_PROVIDERS', connected: false, config: {}, connectedAt: null },
  { key: 'voyage', name: 'Voyage AI', group: 'AI_PROVIDERS', connected: false, config: {}, connectedAt: null },
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
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('renders the AI Providers group from the catalog (AC-BYOK-01)', async () => {
    render(<IntegrationsScreen client={fakeClient()} orgId="o1" />);
    expect(await screen.findByText('Anthropic (Claude)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'AI Providers' })).toBeTruthy();
    // The API-key prompt reuses the connect flow: sent once, never rendered back.
    expect(screen.getByLabelText('Token for Anthropic (Claude)')).toBeTruthy();
  });

  it('renders the voyage tile from the catalog and connects/disconnects it (AC-VBYOK-01)', async () => {
    const client = fakeClient({
      connect: vi.fn(async (_o, key) => ({
        key,
        name: 'Voyage AI',
        group: 'AI_PROVIDERS',
        connected: true,
        config: {},
        connectedAt: '2026-07-06T00:00:00.000Z',
      })),
      disconnect: vi.fn(async (_o, key) => ({
        key,
        name: 'Voyage AI',
        group: 'AI_PROVIDERS',
        connected: false,
        config: {},
        connectedAt: null,
      })),
    });
    render(<IntegrationsScreen client={client} orgId="o1" />);
    expect(await screen.findByText('Voyage AI')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Token for Voyage AI'), { target: { value: 'pa-voyage-123' } });
    fireEvent.click(card('Voyage AI').getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(client.connect).toHaveBeenCalledWith('o1', 'voyage', 'pa-voyage-123'));
    // The raw key never renders back into the screen after connecting.
    expect(screen.queryByDisplayValue('pa-voyage-123')).toBeNull();
    // The now-connected tile disconnects through the same flow (re-queried after the re-render).
    fireEvent.click(card('Voyage AI').getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(client.disconnect).toHaveBeenCalledWith('o1', 'voyage'));
  });

  it('connects the anthropic key through the same flow (AC-BYOK-02)', async () => {
    const client = fakeClient({
      connect: vi.fn(async (_o, key) => ({
        key,
        name: 'Anthropic (Claude)',
        group: 'AI_PROVIDERS',
        connected: true,
        config: {},
        connectedAt: '2026-07-05T00:00:00.000Z',
      })),
    });
    render(<IntegrationsScreen client={client} orgId="o1" />);
    await screen.findByText('Anthropic (Claude)');
    fireEvent.change(screen.getByLabelText('Token for Anthropic (Claude)'), {
      target: { value: 'sk-ant-test-123' },
    });
    fireEvent.click(card('Anthropic (Claude)').getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(client.connect).toHaveBeenCalledWith('o1', 'anthropic', 'sk-ant-test-123'));
    // The raw key never renders back into the screen after connecting.
    await screen.findAllByText('Connected');
    expect(screen.queryByDisplayValue('sk-ant-test-123')).toBeNull();
  });

  it('connects GitHub with a token', async () => {
    const client = fakeClient();
    render(<IntegrationsScreen client={client} orgId="o1" />);
    await screen.findByText('GitHub');
    fireEvent.change(screen.getByLabelText('Token for GitHub'), { target: { value: 'ghp_abc' } });
    fireEvent.click(card('GitHub').getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(client.connect).toHaveBeenCalledWith('o1', 'github', 'ghp_abc'));
  });

  it('disconnects GitLab', async () => {
    const client = fakeClient();
    render(<IntegrationsScreen client={client} orgId="o1" />);
    await screen.findByText('GitLab');
    fireEvent.click(card('GitLab').getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(client.disconnect).toHaveBeenCalledWith('o1', 'gitlab'));
  });
});
