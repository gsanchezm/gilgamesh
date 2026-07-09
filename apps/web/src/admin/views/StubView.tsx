import { useAdmin } from '../AdminContext';

/**
 * Placeholder for a view Phase 2 will implement. Renders the real page chrome (title + subtitle from
 * the view's i18n module) plus a "coming soon" card, so routes resolve and the shell is exercised.
 * A Phase-2 group replaces its own `views/<role>/<View>.tsx` entirely — this file is never edited.
 */
export function StubView({ titleKey, subtitleKey }: { titleKey: string; subtitleKey: string }) {
  const { t } = useAdmin();
  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t(titleKey)}</h1>
        <p className="gx-adm-sub">{t(subtitleKey)}</p>
      </header>
      <div className="gx-adm-card gx-adm-comingsoon">
        <span className="gx-adm-eyebrow">{t('shell.coming_soon')}</span>
        <p className="gx-adm-comingsoon__msg">{t('shell.coming_soon_sub')}</p>
      </div>
    </div>
  );
}
