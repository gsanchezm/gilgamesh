import { useAdmin } from '../../AdminContext';
import { pctWidth } from '../../util';
import { KpiCard } from './_kit';
import './workspace.css';

// NOTE: workspace scope — `getWorkspaceUso` returns `TokensAgenteRowWs` (no `costoUsd`); the token
// table below deliberately has NO cost column (README §5). Totals are the workspace's own.
export function Uso() {
  const { t, service, wsId } = useAdmin();
  const data = service.getWorkspaceUso(wsId);
  const maxTokens = Math.max(...data.tokensPorAgente.map((r) => r.tokens30d), 1);

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('wsu.title')}</h1>
        <p className="gx-adm-sub">{t('wsu.subtitle')}</p>
      </header>

      <div className="gx-adm-kpirow">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      <section className="gx-adm-card">
        <div className="gx-adm-panelhead">
          <span className="gx-adm-eyebrow">{t('wsu.tokens_title')}</span>
          <span className="gx-adm-mrr__unit">{t('wsu.tokens_unit')}</span>
        </div>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-ws-table">
            <thead>
              <tr>
                <th>{t('wsu.col_agente')}</th>
                <th>{t('wsu.col_esp')}</th>
                <th />
                <th>{t('wsu.col_tokens')}</th>
              </tr>
            </thead>
            <tbody>
              {data.tokensPorAgente.map((r) => (
                <tr key={r.agente}>
                  <td>
                    <span className="gx-ws-agent">
                      <span className="gx-ws-agent__glifo" style={{ background: r.color }}>
                        {r.glifo}
                      </span>
                      <span className="gx-ws-name">{r.agente}</span>
                    </span>
                  </td>
                  <td>{t(r.especialidad)}</td>
                  <td>
                    <div className="gx-adm-meter gx-ws-tokbar">
                      <span
                        className="gx-adm-meter__fill"
                        style={{ width: pctWidth(r.tokens30d, maxTokens), background: r.color }}
                      />
                    </div>
                  </td>
                  <td className="gx-ws-mono">{r.tokens30d}M</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gx-ws-total">
          <span>{t('wsu.total')}</span>
          <span>{data.tokensTotal}M</span>
        </div>
      </section>
    </div>
  );
}
