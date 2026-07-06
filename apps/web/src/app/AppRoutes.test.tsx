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
        id: 'ag-web', slot: 'web', deityName: 'Quetzalcóatl', role: 'Web Automation', family: 'ui',
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
      forgotPassword: vi.fn(async () => {}),
      resetPassword: vi.fn(async () => {}),
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
        getBrainUsage: vi.fn(async () => ({
          totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
          byTier: [],
          bySurface: [],
        })),
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
        id: 'm1', sessionId: 's1', role: 'USER' as const, agentId: null, content: 'hi', runId: null, createdAt: '2026-07-05T00:00:00.000Z',
      })),
      listSessions: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
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

  it('surfaces the SSO back-channel notice on /login?sso=unavailable (slice 15, AC-SSO-10)', async () => {
    renderApp(makeClients(), '/login?sso=unavailable');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Google sign-in is not available on this server yet.');
    // The Google entry itself is a real link to the API start route.
    const google = screen.getByRole('link', { name: 'Google' });
    expect(google.getAttribute('href')).toBe('/api/v1/auth/sso/google/start');
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

  it('the agent tile Chat action deep-links into a pinned chat (slice 11 tile-pinned entry)', async () => {
    const clients = makeClients();
    render(
      <ThemeProvider>
        <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-1' })}>
          <ClientsProvider clients={clients}>
            <MemoryRouter initialEntries={['/projects/p-1/agents']}>
              <AppRoutes />
            </MemoryRouter>
          </ClientsProvider>
        </SessionProvider>
      </ThemeProvider>,
    );

    await screen.findByText('1 agents · OmniPizza');
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));

    // The ChatScreen mounted for the project (session rail loads) with the agent pinned from
    // `?agent=ag-web`: the capture-07 pinned header shows the deity's status · tool line.
    await waitFor(() => expect(clients.chat.listSessions).toHaveBeenCalledWith('p-1'));
    expect(await screen.findByText('Active · Playwright')).toBeTruthy();
    expect(screen.getByRole('button', { name: '← Agents' })).toBeTruthy();
  });

  it('navigates login → forgot-password and submits the recovery request (AC-REC-05)', async () => {
    const clients = makeClients();
    renderApp(clients, '/login');

    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(await screen.findByRole('heading', { name: 'Forgot password' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('name@company.com'), {
      target: { value: 'ishtar@uruk.io' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send reset link/ }));

    expect(
      (await screen.findByRole('status')).textContent,
    ).toContain('If an account exists for that email, a reset link is on its way.');
    expect(clients.auth.forgotPassword).toHaveBeenCalledWith({ email: 'ishtar@uruk.io' });

    // Back to sign in completes the loop.
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('serves /reset-password?token=… publicly and posts the token with the new password (AC-REC-05)', async () => {
    const clients = makeClients();
    renderApp(clients, '/reset-password?token=raw-tok-1');

    expect(await screen.findByRole('heading', { name: 'Reset password' })).toBeTruthy();
    const inputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(inputs[0]!, { target: { value: 'N3w-Passphrase!!' } });
    fireEvent.change(inputs[1]!, { target: { value: 'N3w-Passphrase!!' } });
    fireEvent.click(screen.getByRole('button', { name: /Set new password/ }));

    expect((await screen.findByRole('status')).textContent).toContain('Your password has been reset');
    expect(clients.auth.resetPassword).toHaveBeenCalledWith({
      token: 'raw-tok-1',
      newPassword: 'N3w-Passphrase!!',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows the invalid-link state at /reset-password without a token and offers a new request', async () => {
    renderApp(makeClients(), '/reset-password');

    expect((await screen.findByRole('alert')).textContent).toContain('invalid or has expired');
    fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
    expect(await screen.findByRole('heading', { name: 'Forgot password' })).toBeTruthy();
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
