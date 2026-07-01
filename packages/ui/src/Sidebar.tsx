import type { ReactNode } from 'react';
import type { AgentRuntimeStatus, AgentSlot } from '@gilgamesh/domain';
import { AgentAvatar } from './AgentAvatar';
import { Badge } from './Badge';
import { IconChevronLeft, IconChevronRight, IconLogout } from './icons';

export interface SidebarNavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface SidebarAgent {
  slot: AgentSlot;
  deityName: string;
  glyph: string;
  familyColor: string;
  tool: string;
  status: AgentRuntimeStatus;
  portraitSrc?: string;
}

export interface SidebarProps {
  items: SidebarNavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  agents?: SidebarAgent[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onLogout: () => void;
  brandMarkSrc?: string;
}

/** Two-letter tool tag for the agents rail (e.g. "Strategy" → "ST"). */
function toolTag(tool: string): string {
  return tool.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * Collapsible app sidebar (handoff §6.4): brand, stroke-icon nav with an active row, an Agents rail
 * of mini-avatars, and collapse / log-out controls. Presentational — the host wires navigation,
 * collapse state and data, so it stays framework- and router-agnostic.
 */
export function Sidebar({
  items,
  activeKey,
  onNavigate,
  agents,
  collapsed,
  onToggleCollapse,
  onLogout,
  brandMarkSrc,
}: SidebarProps) {
  return (
    <aside className="gx-sidebar" data-collapsed={collapsed}>
      <div className="gx-sidebar__brand">
        <span
          className="gx-sidebar__mark"
          style={brandMarkSrc ? { backgroundImage: `url(${brandMarkSrc})` } : undefined}
        />
        {!collapsed && (
          <span className="gx-sidebar__brandtext">
            <span className="gx-sidebar__logo">GILGAMESH</span>
            <span className="gx-sidebar__tagline">TESTING · ELEVATED</span>
          </span>
        )}
      </div>

      <nav className="gx-sidebar__nav">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className="gx-sidebar__item"
            data-active={it.key === activeKey}
            aria-current={it.key === activeKey ? 'page' : undefined}
            title={collapsed ? it.label : undefined}
            onClick={() => onNavigate(it.key)}
          >
            <span className="gx-sidebar__icon">{it.icon}</span>
            {!collapsed && <span className="gx-sidebar__label">{it.label}</span>}
          </button>
        ))}
      </nav>

      {agents && agents.length > 0 && !collapsed && (
        <div className="gx-sidebar__agents">
          <span className="gx-eyebrow gx-sidebar__agentshead">Agents</span>
          <ul className="gx-sidebar__agentlist">
            {agents.map((a) => (
              <li key={a.slot}>
                <button type="button" className="gx-sidebar__agent" onClick={() => onNavigate('dashboard')}>
                  <AgentAvatar
                    size="nav"
                    glyph={a.glyph}
                    familyColor={a.familyColor}
                    status={a.status}
                    portraitSrc={a.portraitSrc}
                    deityName={a.deityName}
                  />
                  <span className="gx-sidebar__agentname">{a.deityName}</span>
                  <Badge tone="muted">{toolTag(a.tool)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="gx-sidebar__foot">
        <button type="button" className="gx-sidebar__collapse" onClick={onToggleCollapse}>
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          {!collapsed && <span>Collapse</span>}
        </button>
        <button type="button" className="gx-sidebar__logout" onClick={onLogout} title={collapsed ? 'Log out' : undefined}>
          <IconLogout />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  );
}
