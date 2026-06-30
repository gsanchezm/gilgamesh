import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionProvider, useSession } from './session';

function Probe() {
  const { authed, activeOrgId, booting } = useSession();
  return <div>{booting ? 'booting' : authed ? `authed:${activeOrgId}` : 'anon'}</div>;
}

function ProbeWithSignIn() {
  const { authed, activeOrgId, booting, signIn } = useSession();
  return (
    <div>
      <span data-testid="state">{booting ? 'booting' : authed ? `authed:${activeOrgId}` : 'anon'}</span>
      <button type="button" onClick={() => signIn('org-9')}>
        signin
      </button>
    </div>
  );
}

describe('SessionProvider', () => {
  it('is anonymous and not booting without a bootstrap', () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByText('anon')).toBeTruthy();
  });

  it('shows booting while the restore is pending', () => {
    render(
      <SessionProvider bootstrap={() => new Promise(() => {})}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByText('booting')).toBeTruthy();
  });

  it('restores an authenticated session from the bootstrap', async () => {
    render(
      <SessionProvider bootstrap={async () => ({ activeOrgId: 'org-7' })}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByText('authed:org-7')).toBeTruthy());
  });

  it('stays anonymous when the bootstrap resolves null', async () => {
    render(
      <SessionProvider bootstrap={async () => null}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByText('anon')).toBeTruthy());
  });

  it('does not let a late bootstrap clobber a completed sign-in', async () => {
    let resolveBootstrap: (v: { activeOrgId: string | null } | null) => void = () => {};
    const bootstrap = () =>
      new Promise<{ activeOrgId: string | null } | null>((resolve) => {
        resolveBootstrap = resolve;
      });

    render(
      <SessionProvider bootstrap={bootstrap}>
        <ProbeWithSignIn />
      </SessionProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('booting');

    // User completes sign-in while the /auth/me bootstrap is still in flight.
    fireEvent.click(screen.getByText('signin'));
    expect(screen.getByTestId('state').textContent).toBe('authed:org-9');

    // The slow bootstrap resolves null (pre-cookie 401) AFTER sign-in — flush the settle microtask
    // and assert it did NOT overwrite the completed sign-in.
    await act(async () => {
      resolveBootstrap(null);
    });
    expect(screen.getByTestId('state').textContent).toBe('authed:org-9');
  });
});
