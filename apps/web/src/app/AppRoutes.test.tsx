import { ThemeProvider } from '@gilgamesh/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      register: vi.fn(async () => ({ userId: 'u-1' })),
      me: vi.fn(async () => null),
      logout: vi.fn(async () => {}),
    },
    onboarding: { createProject: vi.fn(async () => ({ projectId: 'p-1', slug: 'omnipizza' })) },
    agents: {
      getAgentRoom: vi.fn(async () => room()),
      setAgent: vi.fn(async () => room().agents[0]!),
      wakeAll: vi.fn(async () => ({ awake: 1, total: 1 })),
    },
    testlab: {
      listSlices: vi.fn(async () => []),
      createSlice: vi.fn(async () => ({ id: 's1', key: 'k', name: 'K', order: 0 })),
      listFeatures: vi.fn(async () => []),
      getFeature: vi.fn(async () => ({ id: 'f1', name: 'F', path: 'f.feature', sliceId: null, content: '', scenarios: [] })),
      createFeature: vi.fn(async () => ({ id: 'f1', name: 'F', path: 'f.feature', sliceId: null, content: '', scenarios: [] })),
      listTestCases: vi.fn(async () => []),
      createTestCase: vi.fn(async () => ({
        id: 't1', key: 'TC_PRJ_001', title: 'T', steps: '', data: '', expected: '', priority: 'MEDIUM' as const, status: 'NOTRUN', sliceId: null, assignedAgentId: null,
      })),
      generate: vi.fn(async () => ({ features: [], testCases: [] })),
    },
    runs: {
      triggerRun: vi.fn(async () => ({
        id: 'r1', projectId: 'p-1', status: 'DONE' as const, targetKind: 'FEATURE' as const, targetId: 'f1',
        runLabel: null, passed: 1, failed: 0, skipped: 0, total: 1, ratePct: 100, durationMs: 5,
        createdAt: '2026-06-30T00:00:00.000Z', results: [],
      })),
      listRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => ({
        id: 'r1', projectId: 'p-1', status: 'DONE' as const, targetKind: 'FEATURE' as const, targetId: 'f1',
        runLabel: null, passed: 1, failed: 0, skipped: 0, total: 1, ratePct: 100, durationMs: 5,
        createdAt: '2026-06-30T00:00:00.000Z', results: [],
      })),
    },
    billing: (() => {
      const sub = {
        plan: 'FREE' as const, status: 'TRIALING', billingCycle: 'MONTHLY' as const, seats: 1, maxSeats: 1,
        maxServicesPerWorkspace: 2, maxUsersPerWorkspace: 1, includedWorkspaces: 1,
        unlimited: false, runMinutesQuota: 500, runMinutesUsed: 0, priceCents: 0,
        providerCustomerId: null, currentPeriodEnd: null,
      };
      return {
        getSubscription: vi.fn(async () => sub),
        changePlan: vi.fn(async () => sub),
        updateSeats: vi.fn(async () => sub),
        checkout: vi.fn(async () => ({ checkoutUrl: 'https://mock.pay/checkout/o' })),
        confirmCheckout: vi.fn(async () => ({ ...sub, status: 'ACTIVE' })),
        cancel: vi.fn(async () => ({ ...sub, status: 'CANCELED' })),
      };
    })(),
    knowledge: {
      search: vi.fn(async () => ({ results: [], total: 0 })),
      listDocuments: vi.fn(async () => []),
      uploadDocument: vi.fn(async () => ({ id: 'd1', name: 'd.md', type: 'md', chunkCount: 1, createdAt: '2026-07-01T00:00:00.000Z' })),
    },
    integrations: {
      list: vi.fn(async () => []),
      connect: vi.fn(async () => ({ key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: true, config: {}, connectedAt: null })),
      disconnect: vi.fn(async () => ({ key: 'github', name: 'GitHub', group: 'SOURCE_REPOS', connected: false, config: {}, connectedAt: null })),
      importRepo: vi.fn(async () => ({ imported: 0 })),
    },
    chat: {
      createSession: vi.fn(async () => ({ id: 's1', projectId: 'p1', agentId: null, createdAt: '2026-07-05T00:00:00.000Z' })),
      sendMessage: vi.fn(async () => ({
        id: 'm1', sessionId: 's1', role: 'USER' as const, agentId: null, content: 'hi', runId: null, at: '2026-07-05T00:00:00.000Z',
      })),
      listMessages: vi.fn(async () => []),
    },
  };
}

function renderApp(clients: Clients, initialPath: string) {
  return render(
    <ThemeProvider>
      <SessionProvider>
        <ClientsProvider clients={clients}>
          <MemoryRouter initialEntries={[initialPath]}>
            <AppRoutes />
          </MemoryRouter>
        </ClientsProvider>
      </SessionProvider>
    </ThemeProvider>,
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

  it('routes a restored-authenticated user landing on / into the app, not the login form', async () => {
    render(
      <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-1' })}>
        <ClientsProvider clients={makeClients()}>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </ClientsProvider>
      </SessionProvider>,
    );
    expect(await screen.findByText('Name your project')).toBeTruthy();
    expect(screen.queryByPlaceholderText('name@company.com')).toBeNull();
  });

  it('navigates login → register and back via Sign in', async () => {
    renderApp(makeClients(), '/login');

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByLabelText('Company')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('registers then continues into onboarding carrying the Company (AC-ONB-14)', async () => {
    const clients = makeClients();
    renderApp(clients, '/register');

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Gabriel' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Sánchez' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme Inc.' } });
    fireEvent.change(screen.getByLabelText('Corporate email'), { target: { value: 'gil@acme.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Name your project')).toBeTruthy();
    expect(clients.auth.register).toHaveBeenCalledTimes(1);
    // The Company survives the register -> onboarding hop (router state) and prefills the wizard.
    // Regression net for the RR7 startTransition race: the RegisterRoute authed-guard's stateless
    // <Navigate replace /> must not beat (and strip) the state-carrying navigation.
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe('Acme Inc.');
  });

  it('flows login → onboarding → agent room', async () => {
    renderApp(makeClients(), '/login');

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'gil@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText('Name your project')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('OmniPizza'), { target: { value: 'OmniPizza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    // The agent-room view loaded inside the shell. Assert the screen's unique subtitle (the nav
    // rail now also has an "Agent room" label, so that text alone is no longer unique).
    expect(await screen.findByText('1 agents · OmniPizza')).toBeTruthy();
  });

  it('renders the Reports view for an authed session at /projects/:projectId/reports', async () => {
    const clients = makeClients();
    render(
      <ThemeProvider>
        <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-1' })}>
          <ClientsProvider clients={clients}>
            <MemoryRouter initialEntries={['/projects/p1/reports']}>
              <AppRoutes />
            </MemoryRouter>
          </ClientsProvider>
        </SessionProvider>
      </ThemeProvider>,
    );

    // The ReportsScreen subtitle is unique to the real view (the ComingSoon placeholder never renders it).
    expect(
      await screen.findByText('Test automation report — aggregated across every run in this project.'),
    ).toBeTruthy();
    // The route wires the runs client with the projectId from the URL (the fake returns no runs).
    expect(await screen.findByText(/No runs yet/i)).toBeTruthy();
    await waitFor(() => expect(clients.runs.listRuns).toHaveBeenCalledWith('p1'));
  });
});
