import { useAdmin } from '../../AdminContext';
import { fmtNum, relTime } from '../../util';
import { AgentPills, FormatChip } from './_kit';
import './workspace.css';

/** Success-rate colour band (README §4.6): ≥94 green · ≥90 amber · <90 red. */
function exitoColor(pct: number): string {
  return pct >= 94 ? '#3FB07A' : pct >= 90 ? '#C08A2E' : '#E0738A';
}

// NOTE: workspace scope — the rows carry NO `costo30d` and NO client identity (the service strips
// them; the ProyectoRowWs type doesn't even declare them). So there is deliberately no cost column.
export function Proyectos() {
  const { t, lang, service, wsId } = useAdmin();
  const rows = service.getWorkspaceProyectos(wsId);

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('wsp.title')}</h1>
        <p className="gx-adm-sub">{t('wsp.subtitle')}</p>
      </header>

      <section className="gx-adm-card">
        {rows.length === 0 ? (
          <p className="gx-adm-comingsoon__msg">{t('wsp.empty')}</p>
        ) : (
          <div className="gx-adm-tablewrap">
            <table className="gx-adm-table gx-ws-table">
              <thead>
                <tr>
                  <th>{t('wsp.col_proyecto')}</th>
                  <th>{t('wsp.col_formato')}</th>
                  <th>{t('wsp.col_agentes')}</th>
                  <th>{t('wsp.col_runs')}</th>
                  <th>{t('wsp.col_exito')}</th>
                  <th>{t('wsp.col_ultima')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="gx-ws-name">{p.nombre}</span>
                    </td>
                    <td>
                      <FormatChip formato={p.formato} t={t} />
                    </td>
                    <td>
                      <AgentPills agentes={p.agentes} />
                    </td>
                    <td className="gx-ws-mono">{fmtNum(p.runs30d)}</td>
                    <td className="gx-ws-mono" style={{ color: exitoColor(p.exitoPct) }}>
                      {p.exitoPct}%
                    </td>
                    <td className="gx-ws-mono">{relTime(lang, p.ultimaEjecucion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
