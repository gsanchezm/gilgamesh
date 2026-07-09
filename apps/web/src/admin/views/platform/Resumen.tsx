import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import { CATEGORIA_COLOR, PLAN_COLOR } from '../../data/mock';
import type { Kpi } from '../../data/types';
import { fmtUsd, pctWidth } from '../../util';

/** KPI value: a "9 / 10" reads as a big "9" + muted " / 10"; a plain value renders whole. */
function KpiValue({ value }: { value: string }) {
  const [head, ...rest] = value.split(' / ');
  if (rest.length === 0) return <span className="gx-adm-kpi__value">{value}</span>;
  return (
    <span className="gx-adm-kpi__value">
      {head}
      <span className="gx-adm-kpi__valuemuted"> / {rest.join(' / ')}</span>
    </span>
  );
}

function KpiCard({ kpi, t }: { kpi: Kpi; t: (k: string) => string }) {
  return (
    <article className="gx-adm-kpi" data-tone={kpi.tone ?? 'default'}>
      <span className="gx-adm-kpi__label">{t(kpi.label)}</span>
      <KpiValue value={kpi.value} />
      {kpi.sub && <span className="gx-adm-kpi__sub">{t(kpi.sub)}</span>}
    </article>
  );
}

export function Resumen() {
  const { t, service, showToast } = useAdmin();
  const navigate = useNavigate();
  const data = service.getPlatformResumen();
  const maxMrrK = Math.max(...data.mrrSeries.map((p) => p.valorK));
  const maxTop = Math.max(...data.topClientes.map((c) => c.mrr), 1);

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('resumen.title')}</h1>
        <p className="gx-adm-sub">{t('resumen.subtitle')}</p>
      </header>

      {/* 5 KPI cards */}
      <div className="gx-adm-kpirow">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Monthly MRR — 12-month bars, current month solid gold */}
      <section className="gx-adm-card gx-adm-mrr">
        <div className="gx-adm-panelhead">
          <span className="gx-adm-eyebrow">{t('resumen.mrr_title')}</span>
          <span className="gx-adm-mrr__unit">{t('resumen.mrr_unit')}</span>
        </div>
        <div className="gx-adm-mrr__chart">
          {data.mrrSeries.map((p) => (
            <div className="gx-adm-mrr__col" key={p.mes}>
              <div className="gx-adm-mrr__barbox">
                <div
                  className="gx-adm-mrr__bar"
                  data-current={p.actual}
                  style={{ height: pctWidth(p.valorK, maxMrrK) }}
                  title={`$${p.valorK}k`}
                />
              </div>
              <span className="gx-adm-mrr__mlabel">{t(`resumen.m_${p.mes}`)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="gx-adm-grid2">
        {/* MRR movement */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('resumen.movement_title')}</span>
          <ul className="gx-adm-mv">
            <li>
              <span>{t('resumen.mv_nuevo')}</span>
              <span className="gx-adm-pos">+{fmtUsd(data.mrrMovement.nuevo)}</span>
            </li>
            <li>
              <span>{t('resumen.mv_expansion')}</span>
              <span className="gx-adm-pos">+{fmtUsd(data.mrrMovement.expansion)}</span>
            </li>
            <li>
              <span>{t('resumen.mv_churn')}</span>
              <span className="gx-adm-neg">−{fmtUsd(data.mrrMovement.churn)}</span>
            </li>
            <li className="gx-adm-mv__net">
              <span>{t('resumen.mv_neto')}</span>
              <span className="gx-adm-pos">+{fmtUsd(data.mrrMovement.neto)}</span>
            </li>
          </ul>
        </section>

        {/* Top clients by MRR */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('resumen.top_title')}</span>
          <ul className="gx-adm-top">
            {data.topClientes.map((c) => (
              <li key={c.id}>
                <button type="button" className="gx-adm-top__row" onClick={() => navigate(`/admin/clientes/${c.id}`)}>
                  <span className="gx-adm-top__name">{c.nombre}</span>
                  <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': PLAN_COLOR[c.plan] } as CSSProperties}>
                    {t(`plan.${c.plan}`)}
                  </span>
                  <span className="gx-adm-top__mrr">{fmtUsd(c.mrr)}</span>
                  <span className="gx-adm-top__track" aria-hidden="true">
                    <span className="gx-adm-top__fill" style={{ width: pctWidth(c.mrr, maxTop) }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="gx-adm-grid2">
        {/* Collections */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('resumen.cobranza_title')}</span>
          <ul className="gx-adm-cob">
            <li>
              <span>{t('resumen.cob_porcobrar')}</span>
              <span className="gx-adm-amber">{fmtUsd(data.cobranza.porCobrar)}</span>
            </li>
            <li>
              <span>{t('resumen.cob_vencido')}</span>
              <span className="gx-adm-neg">
                {fmtUsd(data.cobranza.vencidoMonto)} · {data.cobranza.vencidoCliente}
              </span>
            </li>
            <li>
              <span>{t('resumen.cob_renovaciones')}</span>
              <span className="gx-adm-mono">
                {data.cobranza.renovaciones} · {fmtUsd(data.cobranza.renovacionesMonto)}
              </span>
            </li>
          </ul>
        </section>

        {/* Health (mini) */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('resumen.salud_title')}</span>
          <ul className="gx-adm-salud">
            <li>
              <span className="gx-adm-dot" style={{ background: '#3FB07A' }} />
              <span>{t('resumen.salud_uptime')}</span>
              <span className="gx-adm-mono gx-adm-pos">{data.saludMini.uptime}</span>
            </li>
            <li>
              <span className="gx-adm-dot" style={{ background: '#C08A2E' }} />
              <span>
                1 {t('resumen.salud_incidente')} ({data.saludMini.incidenteId})
              </span>
            </li>
            <li>
              <span className="gx-adm-dot" style={{ background: '#8597B4' }} />
              <span>{t('resumen.salud_cola')}</span>
              <span className="gx-adm-mono">
                {data.saludMini.cola} {t('resumen.salud_jobs')}
              </span>
            </li>
          </ul>
          <button type="button" className="gx-adm-link" onClick={() => navigate('/admin/salud')}>
            {t('resumen.salud_link')} →
          </button>
        </section>
      </div>

      {/* Recent activity — last 5 audit entries */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('resumen.actividad_title')}</span>
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
  );
}
