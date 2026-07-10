import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../app/session';
import type { AdminRole } from './data/types';
import { RoleGuard } from './RoleGuard';

type Restore = { activeOrgId: string | null } | null;

/**
 * Mount `RoleGuard` at `/start` with `/login` and `/` sinks so a redirect lands on an observable page.
 * The guard reads role/wsId from props (not the URL), so the mount path is arbitrary.
 */
function renderGuard(opts: {
  role: AdminRole;
  wsId?: string;
  bootstrap?: () => Promise<Restore>;
}) {
  return render(
    <SessionProvider bootstrap={opts.bootstrap}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route
            path="/start"
            element={
              <RoleGuard role={opts.role} wsId={opts.wsId}>
                <div>ADMIN CONTENT</div>
              </RoleGuard>
            }
          />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route path="/" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

const authedAs = (activeOrgId: string | null) => async () => ({ activeOrgId });

describe('admin RoleGuard — access gate', () => {
  // The platform flag is read from import.meta.env at render; keep each test's stub isolated.
  afterEach(() => vi.unstubAllEnvs());

  it('bounces a logged-out visitor from the PLATFORM tree to /login', async () => {
    renderGuard({ role: 'platform' }); // no bootstrap → anonymous (authed=false)
    expect(await screen.findByText('LOGIN PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('bounces a logged-out visitor from the WORKSPACE tree to /login', async () => {
    renderGuard({ role: 'workspace', wsId: 'org-1' });
    expect(await screen.findByText('LOGIN PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('shows the booting loader (no redirect flash) while the session restores', () => {
    renderGuard({ role: 'platform', bootstrap: () => new Promise<Restore>(() => {}) });
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('LOGIN PAGE')).toBeNull();
    expect(screen.queryByText('HOME PAGE')).toBeNull();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('redirects the WORKSPACE tree to / when wsId !== the active org (no 403, like not-found)', async () => {
    renderGuard({ role: 'workspace', wsId: 'org-2', bootstrap: authedAs('org-1') });
    expect(await screen.findByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('redirects the WORKSPACE tree to / when the user has no active org yet (just-registered)', async () => {
    renderGuard({ role: 'workspace', wsId: 'org-1', bootstrap: authedAs(null) });
    expect(await screen.findByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('renders the WORKSPACE tree when authed and wsId === the active org', async () => {
    renderGuard({ role: 'workspace', wsId: 'org-1', bootstrap: authedAs('org-1') });
    expect(await screen.findByText('ADMIN CONTENT')).toBeTruthy();
  });

  it('redirects the PLATFORM tree to / for an authed customer when the flag is off (default)', async () => {
    // No stub → VITE_ENABLE_PLATFORM_ADMIN is undefined: the real shipped default.
    renderGuard({ role: 'platform', bootstrap: authedAs('org-1') });
    expect(await screen.findByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('renders the PLATFORM tree when authed AND the flag is explicitly on', async () => {
    vi.stubEnv('VITE_ENABLE_PLATFORM_ADMIN', 'true');
    renderGuard({ role: 'platform', bootstrap: authedAs('org-1') });
    expect(await screen.findByText('ADMIN CONTENT')).toBeTruthy();
  });

  it('treats any non-"true" flag value as off (only the exact string enables the platform tree)', async () => {
    vi.stubEnv('VITE_ENABLE_PLATFORM_ADMIN', '1');
    renderGuard({ role: 'platform', bootstrap: authedAs('org-1') });
    expect(await screen.findByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });
});
