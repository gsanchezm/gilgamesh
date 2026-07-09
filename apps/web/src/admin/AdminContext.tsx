import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminRole, Lang } from './data/types';
import { T } from './i18n';
import { mockAdminService, type AdminService } from './service/admin-service';

const LANG_KEY = 'gx-admin-lang';

export interface AdminContextValue {
  role: AdminRole;
  wsId: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  period: string;
  setPeriod: (p: string) => void;
  toast: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;
  selClient: string | null;
  setSelClient: (id: string | null) => void;
  selProject: string | null;
  setSelProject: (id: string | null) => void;
  service: AdminService;
  /** Bound translator for the active language. */
  t: (key: string) => string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

function readLang(): Lang {
  if (typeof window === 'undefined') return 'es';
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    /* localStorage may be unavailable; fall back. */
  }
  return 'es';
}

/**
 * Admin console state. `role`/`wsId` are DERIVED from the mounted route tree (a role switch is a
 * navigation, which remounts the other tree → the provider re-inits with the other role). `lang` is
 * persisted to localStorage precisely so it survives that remount. Theme comes from the app-level
 * ThemeProvider (`data-theme`) — the admin does not own it.
 */
export function AdminProvider({
  role,
  wsId,
  service = mockAdminService,
  children,
}: {
  role: AdminRole;
  wsId: string;
  service?: AdminService;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(() => readLang());
  const [period, setPeriod] = useState('30d');
  const [toast, setToast] = useState<string | null>(null);
  const [selClient, setSelClient] = useState<string | null>(null);
  const [selProject, setSelProject] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const clearToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(msg);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Clean up a pending auto-dismiss on unmount.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo<AdminContextValue>(
    () => ({
      role,
      wsId,
      lang,
      setLang,
      period,
      setPeriod,
      toast,
      showToast,
      clearToast,
      selClient,
      setSelClient,
      selProject,
      setSelProject,
      service,
      t: (key: string) => T(lang, key),
    }),
    [role, wsId, lang, setLang, period, toast, showToast, clearToast, selClient, selProject, service],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within an AdminProvider');
  return ctx;
}
