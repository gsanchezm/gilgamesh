import type { CSSProperties } from 'react';
import { useAdmin } from '../../AdminContext';
import type { MiembroEquipo, UsuariosView } from '../../data/types';
import { relTime } from '../../util';
import './Usuarios.css';

// Role pill colour (README-admin §4.10): Owner gold, everyone else blue.
const ROL_COLOR = (rol: string): string => (rol === 'roles.owner' ? '#C9A14E' : '#3F6FA3');
// 2FA status dot colour: active green, pending amber (handoff §4.3 status palette).
const DOSFA_COLOR: Record<MiembroEquipo['dosFA'], string> = { activa: '#3FB07A', pendiente: '#C08A2E' };

function RolChip({ rol, label }: { rol: string; label: string }) {
  return (
    <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': ROL_COLOR(rol) } as CSSProperties}>
      {label}
    </span>
  );
}

export function Usuarios() {
  const { t, service, showToast, lang } = useAdmin();
  const data: UsuariosView = service.getUsuarios();

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('usuarios.title')}</h1>
        <p className="gx-adm-sub">{t('usuarios.subtitle')}</p>
      </header>

      {/* Equipo Gilgamesh — internal staff (name · email · role · 2FA · last activity) */}
      <section className="gx-adm-card">
        <div className="gx-adm-panelhead">
          <span className="gx-adm-eyebrow">{t('usuarios.eq_title')}</span>
          <button type="button" className="gx-adm-usuarios__invite" onClick={() => showToast(t('usuarios.invite_toast'))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('usuarios.invite')}
          </button>
        </div>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-usuarios__table">
            <thead>
              <tr>
                <th>{t('usuarios.col_usuario')}</th>
                <th>{t('usuarios.col_correo')}</th>
                <th>{t('usuarios.col_rol')}</th>
                <th>{t('usuarios.col_2fa')}</th>
                <th>{t('usuarios.col_actividad')}</th>
              </tr>
            </thead>
            <tbody>
              {data.equipoGilgamesh.map((m) => (
                <tr key={m.correo}>
                  <td className="gx-adm-usuarios__name">{m.nombre}</td>
                  <td className="gx-adm-usuarios__email">{m.correo}</td>
                  <td>
                    <RolChip rol={m.rol} label={t(m.rol)} />
                  </td>
                  <td>
                    <span className="gx-adm-status" style={{ color: DOSFA_COLOR[m.dosFA] }}>
                      <span className="gx-adm-status__dot" style={{ background: DOSFA_COLOR[m.dosFA] }} />
                      {t(`twofa.${m.dosFA}`)}
                    </span>
                  </td>
                  <td className="gx-adm-mono gx-adm-usuarios__activity">{relTime(lang, m.ultimaActividad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admins de workspaces — customer-account admins (user · email · workspace · role) */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('usuarios.ws_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-usuarios__table">
            <thead>
              <tr>
                <th>{t('usuarios.col_usuario')}</th>
                <th>{t('usuarios.col_correo')}</th>
                <th>{t('usuarios.col_workspace')}</th>
                <th>{t('usuarios.col_rol')}</th>
              </tr>
            </thead>
            <tbody>
              {data.adminsWorkspaces.map((a) => (
                <tr key={a.correo}>
                  <td className="gx-adm-usuarios__name">{a.usuario}</td>
                  <td className="gx-adm-usuarios__email">{a.correo}</td>
                  <td>
                    <span className="gx-adm-usuarios__ws">
                      <span className="gx-adm-chip" style={{ background: a.wsColor }}>
                        {a.wsAbbr}
                      </span>
                      <span className="gx-adm-usuarios__wsname">{a.wsNombre}</span>
                    </span>
                  </td>
                  <td>
                    <RolChip rol={a.rol} label={t(a.rol)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
