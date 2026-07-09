import { useEffect, useRef, type ReactNode } from 'react';
import { Sidebar, type SidebarAgent, type SidebarNavItem } from './Sidebar';
import { Topbar, type TopbarProject } from './Topbar';
import type { ThemeName } from './theme';

const SIDEBAR_ID = 'gx-sidebar';

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
  // Mobile off-canvas nav (all optional → desktop-only hosts are byte-for-byte unchanged; the
  // hamburger + backdrop only render when `onToggleMobileNav` is wired).
  mobileNavOpen?: boolean;
  onToggleMobileNav?: () => void;
  onCloseMobileNav?: () => void;
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
  mobileNavOpen = false,
  onToggleMobileNav,
  onCloseMobileNav,
  children,
}: AppShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  const focusHamburger = () => {
    (shellRef.current?.querySelector('.gx-topbar__menu') as HTMLElement | null)?.focus();
  };
  const closeAndRefocus = () => {
    onCloseMobileNav?.();
    focusHamburger();
  };

  // While the drawer is open: Esc closes it (focus returns to the hamburger), and focus moves into
  // the drawer on open. No full focus trap — the cheap, testable version (per spec a11y note).
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRefocus();
    };
    document.addEventListener('keydown', onKey);
    (shellRef.current?.querySelector('.gx-sidebar__item') as HTMLElement | null)?.focus();
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileNavOpen]);

  return (
    <div className="gx-shell" data-collapsed={collapsed} data-mobileopen={mobileNavOpen} ref={shellRef}>
      <Sidebar
        id={SIDEBAR_ID}
        mobileOpen={mobileNavOpen}
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
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={onToggleMobileNav}
          mobileNavId={SIDEBAR_ID}
        />
        <main className="gx-shell__content">{children}</main>
      </div>
      {mobileNavOpen && (
        <button type="button" className="gx-backdrop" aria-label="Close navigation" onClick={closeAndRefocus} />
      )}
    </div>
  );
}
