import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRoomData } from '../lib/agents-client';
import { AppRoutes } from './AppRoutes';
import { ClientsProvider, type Clients } from './clients';
import { SessionProvider } from './session';

function room(): AgentRoomData {
  return {
    project: { id: 'p-1', name: 'OmniPizza', slug: 'omnipizza', format: 'BDD' },
    agents: [
      {
        slot: 'web', deityName: 'Quetzalcóatl', role: 'Web Automation', family: 'ui',
        familyColor: '#3F6FA3', glyph: 'QC', culture: 'Azteca', tool: 'Playwright',
        toolOptions: ['Playwright', 'Cypress'], enabled: true, status: 'ACTIVE',
      },
    ],
    kpis: { awake: 1, total: 1, successRatePct: null, scenarios: 0 },
  };
}

function makeClients(): Clients {
  return {
    auth: {
      login: vi.fn(async () => ({ activeOrgId: 'org-1' })),
      me: vi.fn(async () => null),
      logout: vi.fn(async () => {}),
    },
    onboarding: { createProject: vi.fn(async () => ({ projectId: 'p-1', slug: 'omnipizza' })) },
    agents: {
      getAgentRoom: vi.fn(async () => room()),
      setAgent: vi.fn(async () => room().agents[0]!),
      wakeAll: vi.fn(async () => ({ awake: 1, total: 1 })),
    },
  };
}

function renderApp(clients: Clients, initialPath: string) {
  return render(
    <SessionProvider>
      <ClientsProvider clients={clients}>
        <MemoryRouter initialEntries={[initialPath]}>
          <AppRoutes />
        </MemoryRouter>
      </ClientsProvider>
    </SessionProvider>,
  );
}

describe('AppRoutes', () => {
  it('redirects an unauthenticated user from a protected route to login', () => {
    renderApp(makeClients(), '/onboarding');
    expect(screen.getByPlaceholderText('name@company.com')).toBeTruthy();
  });

  it('shows a loader (not login) while the session restore is booting', () => {
    render(
      <SessionProvider bootstrap={() => new Promise(() => {})}>
        <ClientsProvider clients={makeClients()}>
          <MemoryRouter initialEntries={['/onboarding']}>
            <AppRoutes />
          </MemoryRouter>
        </ClientsProvider>
      </SessionProvider>,
    );
    expect(screen.queryByPlaceholderText('name@company.com')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('flows login → onboarding → agent room', async () => {
    renderApp(makeClients(), '/login');

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'gil@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Name your project')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), { target: { value: 'OmniPizza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('Agent room')).toBeTruthy();
    expect(screen.getByText('1 agents · OmniPizza')).toBeTruthy();
  });
});
