import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentRoomScreen } from './AgentRoomScreen';
import type { AgentRoomAgent, AgentRoomData, AgentsClient } from '../lib/agents-client';

function room(): AgentRoomData {
  return {
    project: { id: 'p-1', name: 'OmniPizza', slug: 'omnipizza', format: 'BDD' },
    agents: [
      {
        id: 'ag-web', slot: 'web', deityName: 'Quetzalcóatl', role: 'Web Automation', family: 'ui',
        familyColor: '#3F6FA3', glyph: 'QC', culture: 'Azteca', tool: 'Playwright',
        toolOptions: ['Playwright', 'Cypress'], enabled: true, status: 'ACTIVE',
      },
      {
        id: 'ag-api', slot: 'api', deityName: 'Iris', role: 'API Automation', family: 'backend',
        familyColor: '#7E63A6', glyph: 'IR', culture: 'Grecia', tool: 'Postman',
        toolOptions: ['Postman', 'REST Assured', 'Karate'], enabled: false, status: 'IDLE',
      },
    ],
    kpis: { awake: 1, total: 2, successRatePct: null, scenarios: 0 },
  };
}

function fakeClient(overrides?: Partial<AgentsClient>): AgentsClient {
  return {
    getAgentRoom: vi.fn(async () => room()),
    setAgent: vi.fn(
      async (_p, _slot, patch): Promise<AgentRoomAgent> => ({
        ...room().agents[1]!,
        enabled: !!patch.enabled,
        status: patch.enabled ? 'ACTIVE' : 'IDLE',
      }),
    ),
    wakeAll: vi.fn(async () => ({ awake: 2, total: 2 })),
    ...overrides,
  };
}

describe('AgentRoomScreen', () => {
  it('shows a spinner while the agent room loads (slice 37)', async () => {
    // A never-resolving load keeps the screen in its loading state.
    const client = fakeClient({ getAgentRoom: vi.fn(() => new Promise<AgentRoomData>(() => {})) });
    render(<AgentRoomScreen client={client} projectId="p-1" />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByText('Quetzalcóatl')).toBeNull();
  });

  it('shows an error state with retry on load failure; retry re-invokes the load and clears the stale banner (slice 37)', async () => {
    const getAgentRoom = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network down'))
      .mockResolvedValueOnce(room());
    render(<AgentRoomScreen client={fakeClient({ getAgentRoom })} projectId="p-1" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Network down');
    expect(screen.queryByText('Quetzalcóatl')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Quetzalcóatl')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); // stale error cleared on the successful retry
    expect(getAgentRoom).toHaveBeenCalledTimes(2);
  });

  it('loads and renders the project, agents and KPIs', async () => {
    render(<AgentRoomScreen client={fakeClient()} projectId="p-1" />);
    expect(await screen.findByText('Quetzalcóatl')).toBeTruthy();
    expect(screen.getByText('Iris')).toBeTruthy();
    expect(screen.getByText('2 agents · OmniPizza')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('toggles a sleeping agent and updates the awake KPI', async () => {
    const client = fakeClient();
    render(<AgentRoomScreen client={client} projectId="p-1" />);
    await screen.findByText('Iris');

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Iris' }));

    await waitFor(() =>
      expect(client.setAgent).toHaveBeenCalledWith('p-1', 'api', { enabled: true }),
    );
    expect(await screen.findByText('2 / 2')).toBeTruthy();
  });

  it('surfaces an error when a toggle fails and leaves the awake KPI unchanged', async () => {
    const client = fakeClient({
      setAgent: vi.fn(async () => {
        throw new Error('Could not update the agent.');
      }),
    });
    render(<AgentRoomScreen client={client} projectId="p-1" />);
    await screen.findByText('Iris');

    fireEvent.click(screen.getByRole('switch', { name: 'Toggle Iris' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not update the agent.');
    expect(screen.getByText('1 / 2')).toBeTruthy(); // KPI not optimistically changed
  });

  it('passes the agent ID to the chat action (slice 11 — the tile-pinned entry)', async () => {
    const onChatAgent = vi.fn();
    render(<AgentRoomScreen client={fakeClient()} projectId="p-1" onChatAgent={onChatAgent} />);
    await screen.findByText('Quetzalcóatl');

    // Only the awake agent (Quetzalcóatl) offers Chat; the id (not the slot) rides the callback.
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(onChatAgent).toHaveBeenCalledWith('ag-web');
  });

  it('awakens the whole team', async () => {
    const client = fakeClient();
    render(<AgentRoomScreen client={client} projectId="p-1" />);
    await screen.findByText('Quetzalcóatl');

    fireEvent.click(screen.getByRole('button', { name: 'Awaken team' }));

    await waitFor(() => expect(client.wakeAll).toHaveBeenCalledWith('p-1'));
    expect(await screen.findByText('2 / 2')).toBeTruthy();
  });
});
