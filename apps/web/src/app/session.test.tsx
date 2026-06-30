import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionProvider, useSession } from './session';

function Probe() {
  const { authed, activeOrgId, booting } = useSession();
  return <div>{booting ? 'booting' : authed ? `authed:${activeOrgId}` : 'anon'}</div>;
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
});
