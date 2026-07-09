import { useAdmin } from '../../AdminContext';
import { relTime } from '../../util';
import { RolChip, TwoFA } from './_kit';
import './workspace.css';

export function Usuarios() {
  const { t, lang, service, wsId, showToast } = useAdmin();
  const { equipo } = service.getWorkspaceUsuarios(wsId);

  return (
    <div className="gx-adm-page">
      <div className="gx-ws-pagehead">
        <header className="gx-adm-pagehead">
          <h1 className="gx-adm-title">{t('wsusr.title')}</h1>
          <p className="gx-adm-sub">{t('wsusr.subtitle')}</p>
        </header>
        <button type="button" className="gx-ws-btn-gold" onClick={() => showToast(t('wsusr.invited'))}>
          + {t('wsusr.invite')}
        </button>
      </div>

      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsusr.team_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-ws-table">
            <thead>
              <tr>
                <th>{t('wsusr.col_usuario')}</th>
                <th>{t('wsusr.col_correo')}</th>
                <th>{t('wsusr.col_rol')}</th>
                <th>{t('wsusr.col_2fa')}</th>
                <th>{t('wsusr.col_actividad')}</th>
              </tr>
            </thead>
            <tbody>
              {equipo.map((m) => (
                <tr key={m.correo}>
                  <td>
                    <span className="gx-ws-name">{m.nombre}</span>
                  </td>
                  <td className="gx-ws-mono">{m.correo}</td>
                  <td>
                    <RolChip rol={m.rol} t={t} />
                  </td>
                  <td>
                    <TwoFA state={m.dosFA} t={t} />
                  </td>
                  <td className="gx-ws-mono">{relTime(lang, m.ultimaActividad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
