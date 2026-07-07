import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppShell,
  IconAgentRoom,
  IconIntegrations,
  IconKnowledge,
  IconOrchestration,
  IconReports,
  IconTestLab,
  portraitFor,
  useTheme,
  type SidebarNavItem,
} from '@gilgamesh/ui';
import type { AgentRoomData } from '../lib/agents-client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useClients } from './clients';
import { useSession } from './session';

const NAV: SidebarNavItem[] = [
  { key: 'dashboard', label: 'Agent room', icon: <IconAgentRoom /> },
  { key: 'orchestrate', label: 'Orchestration', icon: <IconOrchestration /> },
  { key: 'lab', label: 'Test Lab', icon: <IconTestLab /> },
  { key: 'reports', label: 'Reports', icon: <IconReports /> },
  { key: 'knowledge', label: 'Knowledge base', icon: <IconKnowledge /> },
  { key: 'integrations', label: 'Integrations', icon: <IconIntegrations /> },
];

/** Nav keys that resolve to a project-scoped URL `/projects/:id/<segment>`. */
const PROJECT_SEGMENT: Record<string, string> = {
  dashboard: 'agents',
  orchestrate: 'orchestrate',
  lab: 'lab',
  reports: 'reports',
};

function deriveActiveKey(path: string): string {
  if (path.endsWith('/lab')) return 'lab';
  if (path.endsWith('/orchestrate')) return 'orchestrate';
  if (path.endsWith('/reports')) return 'reports';
  if (path.startsWith('/knowledge')) return 'knowledge';
  if (path.startsWith('/integrations')) return 'integrations';
  return 'dashboard';
}

/**
 * Web binding for the design-system `AppShell`: feeds it router-derived nav state, the theme (from
 * `useTheme`), session/auth (logout) and the active project's agents (for the sidebar rail). The
 * shell itself stays presentational; this is the only place that knows about the router and clients.
 */
export function AppLayout() {
  const { agents: agentsClient, auth } = useClients();
  const { signOut } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // The active project id comes from the URL on project routes; remembered so org-level routes
  // (knowledge/integrations) can still resolve project-scoped nav and keep the topbar context.
  const pidFromUrl = /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const [activePid, setActivePid] = useState<string | null>(pidFromUrl);
  useEffect(() => {
    if (pidFromUrl) setActivePid(pidFromUrl);
  }, [pidFromUrl]);
  const pid = pidFromUrl ?? activePid;

  const [room, setRoom] = useState<AgentRoomData | null>(null);
  useEffect(() => {
    if (!pid) return;
    let active = true;
    agentsClient
      .getAgentRoom(pid)
      .then((d) => {
        if (active) setRoom(d);
      })
      .catch(() => {
        /* the view itself surfaces load errors; the shell just omits the rail */
      });
    return () => {
      active = false;
    };
  }, [agentsClient, pid]);

  const [collapsed, setCollapsed] = useState(false);

  const onNavigate = useCallback(
    (key: string) => {
      const segment = PROJECT_SEGMENT[key];
      if (segment) {
        if (pid) navigate(`/projects/${pid}/${segment}`);
        return;
      }
      navigate(`/${key}`);
    },
    [navigate, pid],
  );

  const onLogout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      /* even if the server call fails, drop the client session and return to login */
    }
    signOut();
    navigate('/login');
  }, [auth, signOut, navigate]);

  const sidebarAgents = useMemo(
    () =>
      room?.agents.map((a) => ({
        slot: a.slot,
        deityName: a.deityName,
        glyph: a.glyph,
        familyColor: a.familyColor,
        tool: a.tool,
        status: a.status,
        portraitSrc: portraitFor(a.slot),
      })),
    [room],
  );

  return (
    <AppShell
      items={NAV}
      activeKey={deriveActiveKey(pathname)}
      onNavigate={onNavigate}
      agents={sidebarAgents}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      onLogout={() => void onLogout()}
      brandMarkSrc="/assets/brand/mark-dark.png"
      project={room ? { name: room.project.name } : undefined}
      user={{ initials: 'GG' }}
      theme={theme}
      onToggleTheme={toggle}
    >
      {/* Keyed by pathname: a screen crash shows the fallback inside the content slot while the
          sidebar/topbar stay usable; navigating (key change) remounts the boundary → auto-recovery. */}
      <ErrorBoundary key={pathname}>
        <Outlet />
      </ErrorBoundary>
    </AppShell>
  );
}
