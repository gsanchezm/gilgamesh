import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface SessionState {
  authed: boolean;
  activeOrgId: string | null;
  /** True while a /auth/me restore is in flight, so guards don't redirect prematurely. */
  booting: boolean;
}

interface SessionContextValue extends SessionState {
  signIn: (activeOrgId: string | null) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** What a session restore resolves to (a subset of the server's MeView). */
type SessionRestore = { activeOrgId: string | null } | null;

/**
 * Client-side session. When a `bootstrap` is provided (the app wires it to GET /auth/me), the
 * provider starts in a `booting` state and restores {authed, activeOrgId} from the httpOnly cookie
 * on mount — so a hard reload or deep-link keeps the user signed in instead of bouncing to /login.
 * Without a bootstrap it is simply anonymous (used by component tests).
 */
export function SessionProvider({
  bootstrap,
  children,
}: {
  bootstrap?: () => Promise<SessionRestore>;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({
    authed: false,
    activeOrgId: null,
    booting: Boolean(bootstrap),
  });

  useEffect(() => {
    if (!bootstrap) return;
    let active = true;
    const settle = (next: SessionState) => {
      if (active) setState(next);
    };
    bootstrap()
      .then((me) =>
        settle(
          me
            ? { authed: true, activeOrgId: me.activeOrgId, booting: false }
            : { authed: false, activeOrgId: null, booting: false },
        ),
      )
      .catch(() => settle({ authed: false, activeOrgId: null, booting: false }));
    return () => {
      active = false;
    };
    // Restore runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      signIn: (activeOrgId) => setState({ authed: true, activeOrgId, booting: false }),
      signOut: () => setState({ authed: false, activeOrgId: null, booting: false }),
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
