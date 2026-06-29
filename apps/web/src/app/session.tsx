import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SessionState {
  authed: boolean;
  activeOrgId: string | null;
}

interface SessionContextValue extends SessionState {
  signIn: (activeOrgId: string | null) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Minimal client-side session for slice 1. The session cookie is httpOnly so the SPA can't
 * read it; on a hard reload `authed` resets and the user is sent to /login. A /auth/me bootstrap
 * that restores the session from the cookie is a later refinement.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ authed: false, activeOrgId: null });
  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      signIn: (activeOrgId) => setState({ authed: true, activeOrgId }),
      signOut: () => setState({ authed: false, activeOrgId: null }),
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
