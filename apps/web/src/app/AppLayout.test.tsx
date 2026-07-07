import { ThemeProvider } from '@gilgamesh/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { ClientsProvider, type Clients } from './clients';
import { SessionProvider } from './session';

// AppLayout wraps the routed <Outlet/> in `<ErrorBoundary key={pathname}>`. These tests pin that
// wiring at the real layout (the ErrorBoundary unit test proves the key mechanism in isolation, but
// nothing else pins that AppLayout keys by *pathname*): a constant key or `pathname + search` both
// leave the component tests green while silently breaking auto-recovery / chat SSE preservation.

// AppLayout only reaches getAgentRoom on /projects/:id routes (pid from the URL); the synthetic /l
// routes below keep pid null, so no async runs and the shell renders synchronously.
const clients = { agents: { getAgentRoom: vi.fn() }, auth: { logout: vi.fn() } } as unknown as Clients;

let probeMounts = 0;

function Boom(): never {
  throw new Error('boom-secret-should-not-render');
}

/** Counts real mounts (not re-renders) and echoes the live query string. */
function Probe() {
  useEffect(() => {
    probeMounts += 1;
  }, []);
  const { search } = useLocation();
  return <div data-testid="probe">probe-content search={search}</div>;
}

/** Always-rendered navigation driver (sibling of the layout route, inside the router). */
function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/l/probe')}>go-probe</button>
      <button onClick={() => navigate('/l/probe?x=1')}>go-probe-query</button>
    </>
  );
}

function renderLayout(initialPath: string) {
  return render(
    <ThemeProvider>
      <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-1' })}>
        <ClientsProvider clients={clients}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Nav />
            <Routes>
              <Route path="/l" element={<AppLayout />}>
                <Route path="boom" element={<Boom />} />
                <Route path="probe" element={<Probe />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ClientsProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
}

describe('AppLayout error-boundary wiring (key={pathname})', () => {
  beforeEach(() => {
    probeMounts = 0;
    // React logs a caught render error to console.error even with a boundary; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the fallback INSIDE the shell on a screen crash, then AUTO-RECOVERS on navigation (kills the constant-key mutation)', () => {
    renderLayout('/l/boom');

    // Fallback rendered in the content slot; the shell chrome (nav rail) survives alongside it.
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Agent room')).toBeTruthy(); // a sidebar nav label = shell still mounted
    // No leak of the thrown error text.
    expect(document.body.textContent).not.toContain('boom-secret-should-not-render');

    // Navigate to a healthy route: the pathname change re-keys the boundary → fresh mount → recovery.
    // With a constant key the stale error state would persist and the fallback would stay stuck.
    fireEvent.click(screen.getByRole('button', { name: 'go-probe' }));
    expect(screen.getByTestId('probe')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('does NOT remount the routed screen on a query-string-only change (kills the pathname+search mutation → preserves chat SSE)', () => {
    renderLayout('/l/probe');
    expect(screen.getByTestId('probe')).toBeTruthy();
    expect(probeMounts).toBe(1);

    // Same pathname, different search (the chat screen's ?agent=/?live=1 pattern). The boundary keys
    // on pathname only, so it must NOT re-key → the screen re-renders (search updates) but is NOT
    // remounted. Keying on pathname+search would remount it and tear down its EventSource.
    fireEvent.click(screen.getByRole('button', { name: 'go-probe-query' }));
    expect(screen.getByTestId('probe').textContent).toContain('search=?x=1'); // navigation happened
    expect(probeMounts).toBe(1); // ...but no remount
  });
});
