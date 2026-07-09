import { useState, type ComponentType } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAdmin } from '../AdminContext';
import {
  IcAjustes,
  IcAuditoria,
  IcCheck,
  IcChevronDown,
  IcClientes,
  IcFacturacion,
  IcGotoPlatform,
  IcIngresos,
  IcPlanes,
  IcProyectos,
  IcResumen,
  IcSalud,
  IcUso,
  IcUsuarios,
} from './admin-icons';

interface NavItem {
  key: string;
  to: string; // relative to the role base ('' = index)
  end?: boolean;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}
interface NavGroup {
  section: string | null;
  items: NavItem[];
}

const PLATFORM_NAV: NavGroup[] = [
  { section: null, items: [{ key: 'resumen', to: '', end: true, label: 'shell.nav_resumen', Icon: IcResumen }] },
  {
    section: 'shell.group_negocio',
    items: [
      { key: 'ingresos', to: 'ingresos', label: 'shell.nav_ingresos', Icon: IcIngresos },
      { key: 'clientes', to: 'clientes', label: 'shell.nav_clientes', Icon: IcClientes },
      { key: 'planes', to: 'planes', label: 'shell.nav_planes', Icon: IcPlanes },
    ],
  },
  {
    section: 'shell.group_operacion',
    items: [
      { key: 'proyectos', to: 'proyectos', label: 'shell.nav_proyectos', Icon: IcProyectos },
      { key: 'uso', to: 'uso', label: 'shell.nav_uso', Icon: IcUso },
      { key: 'salud', to: 'salud', label: 'shell.nav_salud', Icon: IcSalud },
    ],
  },
  {
    section: 'shell.group_admin',
    items: [
      { key: 'usuarios', to: 'usuarios', label: 'shell.nav_usuarios', Icon: IcUsuarios },
      { key: 'auditoria', to: 'auditoria', label: 'shell.nav_auditoria', Icon: IcAuditoria },
    ],
  },
];

const WORKSPACE_NAV: NavGroup[] = [
  {
    section: null,
    items: [
      { key: 'wsr', to: '', end: true, label: 'shell.nav_ws_resumen', Icon: IcResumen },
      { key: 'wsp', to: 'proyectos', label: 'shell.nav_ws_proyectos', Icon: IcProyectos },
      { key: 'wsu', to: 'uso', label: 'shell.nav_ws_uso', Icon: IcUso },
      { key: 'wsusr', to: 'usuarios', label: 'shell.nav_ws_usuarios', Icon: IcUsuarios },
      { key: 'wsf', to: 'facturacion', label: 'shell.nav_ws_facturacion', Icon: IcFacturacion },
      { key: 'wsa', to: 'ajustes', label: 'shell.nav_ws_ajustes', Icon: IcAjustes },
    ],
  },
];

/** Default workspace the platform→workspace switch lands on (also the workspace-role demo account). */
const DEFAULT_WS = 'omnipizza';

export function AdminSidebar() {
  const { role, wsId, t, service } = useAdmin();
  const navigate = useNavigate();
  const [wsOpen, setWsOpen] = useState(false);

  const base = role === 'platform' ? '/admin' : `/w/${wsId}/admin`;
  const nav = role === 'platform' ? PLATFORM_NAV : WORKSPACE_NAV;
  // Cost-free account switcher list — only fetched (and rendered) in the workspace role.
  const clientes = role === 'workspace' ? service.getWorkspaceList() : [];
  const activeWs = clientes.find((c) => c.id === wsId);
  // The active workspace's OWN plan price (their billing — not an internal cost).
  const activeMeta = role === 'workspace' ? service.getWorkspaceMeta(wsId) : undefined;

  const to = (rel: string) => (rel ? `${base}/${rel}` : base);

  return (
    <aside className="gx-adm-sidebar">
      <div className="gx-adm-sidebar__brand">
        <span className="gx-adm-sidebar__mark" aria-hidden="true" />
        <span className="gx-adm-sidebar__brandtext">
          <span className="gx-adm-sidebar__logo">{t('shell.brand')}</span>
          <span className="gx-adm-sidebar__tagline">{t('shell.consola')}</span>
        </span>
      </div>

      {/* Role switch (demo — production derives it from permissions). */}
      <div className="gx-adm-roleswitch" role="tablist" aria-label="role">
        <button
          type="button"
          role="tab"
          aria-selected={role === 'platform'}
          data-active={role === 'platform'}
          className="gx-adm-roleswitch__btn"
          onClick={() => navigate('/admin')}
        >
          {t('shell.role_platform')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={role === 'workspace'}
          data-active={role === 'workspace'}
          className="gx-adm-roleswitch__btn"
          onClick={() => navigate(`/w/${wsId || DEFAULT_WS}/admin`)}
        >
          {t('shell.role_workspace')}
        </button>
      </div>

      {/* Workspace selector — workspace role only. */}
      {role === 'workspace' && (
        <div className="gx-adm-wsselect">
          <button type="button" className="gx-adm-wsselect__btn" onClick={() => setWsOpen((o) => !o)} aria-expanded={wsOpen}>
            <span className="gx-adm-chip" style={{ background: activeWs?.color ?? '#9AA0AC' }}>
              {activeWs?.abbr ?? '??'}
            </span>
            <span className="gx-adm-wsselect__meta">
              <span className="gx-adm-wsselect__name">{activeWs?.nombre ?? wsId}</span>
              <span className="gx-adm-wsselect__sub">
                {t(`plan.${activeWs?.plan ?? 'business'}`)}
                {activeMeta && activeMeta.precioMensualUsd > 0 ? ` · $${activeMeta.precioMensualUsd}${t('common.mo')}` : ''}
              </span>
            </span>
            <IcChevronDown size={14} />
          </button>
          {wsOpen && (
            <ul className="gx-adm-wsselect__list">
              {clientes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="gx-adm-wsselect__opt"
                    data-active={c.id === wsId}
                    onClick={() => {
                      setWsOpen(false);
                      navigate(`/w/${c.id}/admin`);
                    }}
                  >
                    <span className="gx-adm-chip" style={{ background: c.color }}>
                      {c.abbr}
                    </span>
                    <span className="gx-adm-wsselect__optname">{c.nombre}</span>
                    <span className="gx-adm-wsselect__optplan">{t(`plan.${c.plan}`)}</span>
                    {c.id === wsId && (
                      <span className="gx-adm-wsselect__check" aria-hidden="true">
                        <IcCheck size={14} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <nav className="gx-adm-nav">
        {nav.map((group, gi) => (
          <div className="gx-adm-nav__group" key={group.section ?? `g${gi}`}>
            {group.section && <p className="gx-adm-nav__label">{t(group.section)}</p>}
            {group.items.map((item) => (
              <NavLink
                key={item.key}
                to={to(item.to)}
                end={item.end}
                className={({ isActive }) => `gx-adm-nav__item${isActive ? ' active' : ''}`}
                data-key={item.key}
              >
                <span className="gx-adm-nav__icon">
                  <item.Icon size={16} />
                </span>
                <span className="gx-adm-nav__text">{t(item.label)}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="gx-adm-sidebar__foot">
        <a className="gx-adm-sidebar__gotolink" href="/" onClick={(e) => e.preventDefault()}>
          <span className="gx-adm-nav__icon">
            <IcGotoPlatform size={16} />
          </span>
          <span>{t('shell.goto_platform')}</span>
        </a>
        <p className="gx-adm-sidebar__version">{t('shell.version')}</p>
      </div>
    </aside>
  );
}
