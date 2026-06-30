import type { ReactNode } from 'react';
import { Sidebar, type SidebarAgent, type SidebarNavItem } from './Sidebar';
import { Topbar, type TopbarProject } from './Topbar';
import type { ThemeName } from './theme';

export interface AppShellProps {
  // Sidebar
  items: SidebarNavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  agents?: SidebarAgent[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onLogout: () => void;
  brandMarkSrc?: string;
  // Topbar
  project?: TopbarProject;
  user: { initials: string; name?: string };
  theme: ThemeName;
  onToggleTheme: () => void;
  onSearch?: (q: string) => void;
  onOpenProject?: () => void;
  onOpenUser?: () => void;
  // Content
  children: ReactNode;
}

/**
 * The authenticated app chrome (handoff §6.4): a collapsible sidebar + top bar wrapping the active
 * view. Purely presentational composition; the host (web `AppLayout`) feeds it router/session/theme
 * data so the same shell can back a future native app.
 */
export function AppShell({
  items,
  activeKey,
  onNavigate,
  agents,
  collapsed,
  onToggleCollapse,
  onLogout,
  brandMarkSrc,
  project,
  user,
  theme,
  onToggleTheme,
  onSearch,
  onOpenProject,
  onOpenUser,
  children,
}: AppShellProps) {
  return (
    <div className="gx-shell" data-collapsed={collapsed}>
      <Sidebar
        items={items}
        activeKey={activeKey}
        onNavigate={onNavigate}
        agents={agents}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onLogout={onLogout}
        brandMarkSrc={brandMarkSrc}
      />
      <div className="gx-shell__main">
        <Topbar
          project={project}
          user={user}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSearch={onSearch}
          onOpenProject={onOpenProject}
          onOpenUser={onOpenUser}
        />
        <main className="gx-shell__content">{children}</main>
      </div>
    </div>
  );
}
