import type { ThemeName } from './theme';
import { IconChevronDown, IconMenu, IconMic, IconMoon, IconSearch, IconSun } from './icons';

export interface TopbarProject {
  name: string;
  repo?: string;
  branch?: string;
}

export interface TopbarProps {
  project?: TopbarProject;
  user: { initials: string; name?: string };
  theme: ThemeName;
  onToggleTheme: () => void;
  onSearch?: (q: string) => void;
  onOpenProject?: () => void;
  onOpenUser?: () => void;
  searchPlaceholder?: string;
  /** Mobile off-canvas nav channel (distinct from the desktop `collapsed`). CSS shows the hamburger
   *  only ≤767px; on desktop the button is `display:none` so it stays out of the a11y tree. */
  mobileNavOpen?: boolean;
  onToggleMobileNav?: () => void;
  /** id of the drawer the hamburger controls (aria-controls). */
  mobileNavId?: string;
}

/**
 * App top bar (handoff §6.4): project switcher, search, theme toggle, push-to-talk mic and the user
 * menu. Presentational — theme + handlers come from the host. The mic/search are wired by the host
 * where a backend exists; here they are accessible controls.
 */
export function Topbar({
  project,
  user,
  theme,
  onToggleTheme,
  onSearch,
  onOpenProject,
  onOpenUser,
  searchPlaceholder = 'Search agents, suites, reports…',
  mobileNavOpen = false,
  onToggleMobileNav,
  mobileNavId = 'gx-sidebar',
}: TopbarProps) {
  return (
    <header className="gx-topbar">
      {onToggleMobileNav && (
        <button
          type="button"
          className="gx-topbar__menu"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          aria-controls={mobileNavId}
          onClick={onToggleMobileNav}
        >
          <IconMenu />
        </button>
      )}
      {project && (
        <button type="button" className="gx-projswitch" onClick={onOpenProject}>
          <span className="gx-projswitch__mark">{project.name.slice(0, 2).toUpperCase()}</span>
          <span className="gx-projswitch__meta">
            <span className="gx-projswitch__name">{project.name}</span>
            {(project.repo || project.branch) && (
              <span className="gx-projswitch__sub">
                {[project.branch, project.repo].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <IconChevronDown size={16} />
        </button>
      )}

      <form
        className="gx-topbar__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement | null;
          onSearch?.(input?.value ?? '');
        }}
      >
        <IconSearch size={18} />
        <input name="q" type="search" placeholder={searchPlaceholder} aria-label="Search" />
      </form>

      <div className="gx-topbar__actions">
        <button
          type="button"
          className="gx-iconbtn"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <IconMoon /> : <IconSun />}
        </button>
        <button type="button" className="gx-iconbtn gx-iconbtn--mic" aria-label="Push to talk">
          <IconMic />
        </button>
        <button type="button" className="gx-usermenu" aria-label="Account menu" onClick={onOpenUser}>
          {user.initials}
        </button>
      </div>
    </header>
  );
}
