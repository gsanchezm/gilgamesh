import { useEffect, useState } from 'react';
import { useAdmin } from '../../AdminContext';
import type { Formato } from '../../data/types';
import './workspace.css';

const RETENTION_OPTIONS = [30, 60, 90];

type Notif = { slack: boolean; email: boolean; weekly: boolean };

/** Capture 22 — General / Ejecución / Notificaciones / Zona de riesgo. Edits live in local state
 * (spec §6: wsName/wsDomain/wsFmt/wsRet/notif); "Guardar ajustes" only toasts (mock, no backend). */
export function Ajustes() {
  const { t, service, wsId, showToast } = useAdmin();

  const [wsName, setWsName] = useState('');
  const [wsDomain, setWsDomain] = useState('');
  const [wsFmt, setWsFmt] = useState<Formato>('bdd');
  const [wsRet, setWsRet] = useState(60);
  const [notif, setNotif] = useState<Notif>({ slack: true, email: true, weekly: false });

  // Seed the form from the service (and reseed if the active workspace changes without a remount).
  useEffect(() => {
    const a = service.getWorkspaceAjustes(wsId);
    if (!a) return;
    setWsName(a.nombre);
    setWsDomain(a.dominio);
    setWsFmt(a.formato);
    setWsRet(a.retencionDias);
    setNotif({ ...a.notif });
  }, [service, wsId]);

  const toggle = (key: keyof Notif) => setNotif((n) => ({ ...n, [key]: !n[key] }));

  const notifRows: { key: keyof Notif; label: string }[] = [
    { key: 'slack', label: 'wsa.notif_slack' },
    { key: 'email', label: 'wsa.notif_email' },
    { key: 'weekly', label: 'wsa.notif_weekly' },
  ];

  return (
    <div className="gx-adm-page">
      <div className="gx-ws-pagehead">
        <header className="gx-adm-pagehead">
          <h1 className="gx-adm-title">{t('wsa.title')}</h1>
          <p className="gx-adm-sub">{t('wsa.subtitle')}</p>
        </header>
        <button type="button" className="gx-ws-btn-gold" onClick={() => showToast(t('wsa.saved'))}>
          {t('wsa.save')}
        </button>
      </div>

      {/* General */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsa.general')}</span>
        <div className="gx-ws-fieldgrid">
          <label className="gx-ws-field">
            <span className="gx-ws-flabel">{t('wsa.name_label')}</span>
            <input className="gx-ws-input" value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </label>
          <label className="gx-ws-field">
            <span className="gx-ws-flabel">{t('wsa.domain_label')}</span>
            <input className="gx-ws-input" value={wsDomain} onChange={(e) => setWsDomain(e.target.value)} />
          </label>
        </div>
      </section>

      {/* Ejecución */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsa.exec')}</span>
        <div className="gx-ws-fieldgrid">
          <div className="gx-ws-field">
            <span className="gx-ws-flabel">{t('wsa.fmt_label')}</span>
            <div className="gx-ws-seg" role="group">
              <button type="button" data-active={wsFmt === 'bdd'} onClick={() => setWsFmt('bdd')}>
                {t('wsa.fmt_bdd')}
              </button>
              <button type="button" data-active={wsFmt === 'cases'} onClick={() => setWsFmt('cases')}>
                {t('wsa.fmt_cases')}
              </button>
            </div>
          </div>
          <div className="gx-ws-field">
            <span className="gx-ws-flabel">{t('wsa.ret_label')}</span>
            <div className="gx-ws-chips">
              {RETENTION_OPTIONS.map((d) => (
                <button key={d} type="button" className="gx-ws-chip" data-active={wsRet === d} onClick={() => setWsRet(d)}>
                  {d} {t('wsa.ret_days')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Notificaciones */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsa.notif')}</span>
        <div className="gx-ws-notif">
          {notifRows.map((row) => (
            <div className="gx-ws-notif__row" key={row.key}>
              <span>{t(row.label)}</span>
              <button
                type="button"
                className="gx-ws-switch"
                role="switch"
                aria-checked={notif[row.key]}
                aria-label={t(row.label)}
                data-on={notif[row.key]}
                onClick={() => toggle(row.key)}
              >
                <span className="gx-ws-switch__knob" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Zona de riesgo */}
      <section className="gx-adm-card gx-ws-danger">
        <span className="gx-adm-eyebrow">{t('wsa.danger')}</span>
        <p className="gx-adm-comingsoon__msg">{t('wsa.danger_sub')}</p>
        <div className="gx-ws-danger__list">
          <div className="gx-ws-danger__row">
            <span className="gx-ws-danger__label">{t('wsa.transfer')}</span>
            <button type="button" className="gx-ws-btn-danger" onClick={() => showToast(t('wsa.transfer_toast'))}>
              {t('wsa.transfer')}
            </button>
          </div>
          <div className="gx-ws-danger__row">
            <span className="gx-ws-danger__label">{t('wsa.delete')}</span>
            <button type="button" className="gx-ws-btn-danger" onClick={() => showToast(t('wsa.delete_toast'))}>
              {t('wsa.delete')}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
