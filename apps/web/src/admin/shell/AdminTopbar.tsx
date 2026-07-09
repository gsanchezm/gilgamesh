import { useState } from 'react';
import { IconMoon, IconSearch, IconSun, useTheme } from '@gilgamesh/ui';
import { useAdmin } from '../AdminContext';
import { IcChevronDown, IcGotoPlatform } from './admin-icons';

export function AdminTopbar() {
  const { role, wsId, lang, setLang, t, service, showToast } = useAdmin();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const wsMeta = role === 'workspace' ? service.getWorkspaceMeta(wsId) : undefined;
  const badge =
    role === 'platform' ? t('shell.badge_platform') : `${t('shell.badge_workspace')} · ${wsMeta?.nombre ?? wsId}`;

  return (
    <header className="gx-adm-topbar">
      <span className="gx-adm-topbar__badge">{badge}</span>

      <div className="gx-adm-topbar__search">
        <IconSearch size={16} />
        <input type="search" placeholder={t('shell.search')} aria-label={t('shell.search')} />
      </div>

      <button type="button" className="gx-adm-topbar__period" onClick={() => showToast(t('shell.period'))}>
        {t('shell.period')}
        <IcChevronDown size={14} />
      </button>

      <div className="gx-adm-seg" role="group" aria-label="language">
        <button type="button" data-active={lang === 'es'} onClick={() => setLang('es')}>
          ES
        </button>
        <button type="button" data-active={lang === 'en'} onClick={() => setLang('en')}>
          EN
        </button>
      </div>

      <button
        type="button"
        className="gx-adm-topbar__icon"
        onClick={toggle}
        aria-label={t('shell.theme_toggle')}
        title={t('shell.theme_toggle')}
      >
        {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </button>

      <div className="gx-adm-avatar">
        <button type="button" className="gx-adm-avatar__btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="menu">
          GS
        </button>
        {menuOpen && (
          <ul className="gx-adm-avatar__menu">
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  showToast(t('shell.menu_platform'));
                }}
              >
                <IcGotoPlatform size={15} />
                {t('shell.menu_platform')}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  showToast(t('shell.logout'));
                }}
              >
                {t('shell.logout')}
              </button>
            </li>
          </ul>
        )}
      </div>
    </header>
  );
}
