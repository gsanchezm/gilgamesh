import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import { CATEGORIA_COLOR } from '../../data/mock';
import { fmtDate, fmtNum, fmtUsd, pctWidth } from '../../util';
import { KpiCard } from './_kit';
import './workspace.css';

/** Success-rate colour band (README §4.6): ≥94 green · ≥90 amber · <90 red. */
function exitoColor(pct: number): string {
  return pct >= 94 ? '#3FB07A' : pct >= 90 ? '#C08A2E' : '#E0738A';
}

export function Resumen() {
  const { t, lang, service, wsId, showToast } = useAdmin();
  const navigate = useNavigate();
  const data = service.getWorkspaceResumen(wsId);
  const meta = service.getWorkspaceMeta(wsId);

  return (
    <div className="gx-adm-page gx-ws-resumen">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{meta?.nombre ?? t('wsr.title')}</h1>
        <p className="gx-adm-sub">{t('wsr.subtitle')}</p>
      </header>

      {/* KPIs — executions / agent-hours / success rate / seats */}
      <div className="gx-adm-kpirow">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Cycle usage vs plan limits */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsr.uso_title')}</span>
        <div className="gx-ws-usobars">
          {data.usoCiclo.map((bar) => (
            <div className="gx-ws-usobar" key={bar.label}>
              <div className="gx-ws-usobar__head">
                <span className="gx-ws-usobar__label">{t(bar.label)}</span>
                <span className="gx-ws-usobar__val">
                  {fmtNum(bar.valor)} / {fmtNum(bar.limite)}
                </span>
              </div>
              <div className="gx-adm-meter">
                <span
                  className="gx-adm-meter__fill"
                  style={{ width: pctWidth(bar.valor, bar.limite), background: bar.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="gx-adm-grid2">
        {/* Next charge (navy) */}
        <section className="gx-adm-card gx-adm-hero gx-ws-cobro">
          <span className="gx-adm-eyebrow">{t('wsr.cobro_title')}</span>
          <span className="gx-ws-cobro__amount">
            {fmtUsd(data.proximoCobro.montoUsd)}
            <small> {t('common.mo')}</small>
          </span>
          <span className="gx-ws-cobro__meta">
            {t(`plan.${data.proximoCobro.plan}`)} · {t('wsr.cobro_renueva')} {fmtDate(lang, data.proximoCobro.renueva)}
          </span>
          <button type="button" className="gx-ws-cobro__btn" onClick={() => navigate(`/w/${wsId}/admin/facturacion`)}>
            {t('wsr.cobro_link')} →
          </button>
        </section>

        {/* Activity */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('wsr.actividad_title')}</span>
          <ul className="gx-adm-activity">
            {data.actividad.map((a, i) => (
              <li key={`${a.ts}-${i}`} className="gx-adm-activity__row" onClick={() => showToast(t(a.accion))}>
                <span className="gx-adm-mono gx-adm-activity__ts">{a.ts}</span>
                <span
                  className="gx-adm-chip gx-adm-chip--cat"
                  style={{ '--chip': CATEGORIA_COLOR[a.categoria] } as CSSProperties}
                >
                  {t(`categoria.${a.categoria}`)}
                </span>
                <span className="gx-adm-activity__accion">{t(a.accion)}</span>
                <span className="gx-adm-activity__actor">{a.actor}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Projects — clickable rows drill into the Projects view */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsr.proyectos_title')}</span>
        <ul className="gx-ws-prlist">
          {data.proyectos.map((p) => (
            <li key={p.id}>
              <button type="button" className="gx-ws-prrow" onClick={() => navigate(`/w/${wsId}/admin/proyectos`)}>
                <span className="gx-ws-prrow__name">{p.nombre}</span>
                <span className="gx-ws-prrow__runs">
                  {fmtNum(p.runs30d)} {t('wsr.runs_unit')}
                </span>
                <span className="gx-ws-prrow__exito" style={{ color: exitoColor(p.exitoPct) }}>
                  {p.exitoPct}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
