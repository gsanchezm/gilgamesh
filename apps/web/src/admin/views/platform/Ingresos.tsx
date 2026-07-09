import { useMemo, useState, type CSSProperties } from 'react';
import { useAdmin } from '../../AdminContext';
import { PLAN_COLOR } from '../../data/mock';
import type { EstadoFactura } from '../../data/types';
import { fmtDate, fmtUsd, pctWidth } from '../../util';
import './Ingresos.css';

type InvFilter = 'todas' | 'pagadas' | 'pendientes' | 'vencidas';

const ESTADO_COLOR: Record<EstadoFactura, string> = {
  pagada: '#3FB07A',
  pendiente: '#C08A2E',
  vencida: '#E0738A',
};
const ESTADO_KEY: Record<EstadoFactura, string> = {
  pagada: 'ingresos.est_pagada',
  pendiente: 'ingresos.est_pendiente',
  vencida: 'ingresos.est_vencida',
};
// filter → the invoice states it admits.
const FILTER_MATCH: Record<InvFilter, EstadoFactura[] | null> = {
  todas: null,
  pagadas: ['pagada'],
  pendientes: ['pendiente'],
  vencidas: ['vencida'],
};

export function Ingresos() {
  const { t, lang, service, showToast } = useAdmin();
  const data = service.getIngresos();
  const clientById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of service.getClientes()) m.set(c.id, c.nombre);
    return m;
  }, [service]);
  const [filter, setFilter] = useState<InvFilter>('todas');

  const maxMrr = Math.max(...data.mrrPorPlan.map((m) => m.mrr), 1);
  const donutDeg = `${(data.margenPct / 100) * 360}deg`;
  const match = FILTER_MATCH[filter];
  const facturas = match ? data.facturas.filter((f) => match.includes(f.estado)) : data.facturas;

  const filters: InvFilter[] = ['todas', 'pagadas', 'pendientes', 'vencidas'];

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('ingresos.title')}</h1>
        <p className="gx-adm-sub">{t('ingresos.subtitle')}</p>
      </header>

      <div className="gx-adm-grid2">
        {/* MRR por plan */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('ingresos.mrr_title')}</span>
          <ul className="gx-adm-ingresos-mrr">
            {data.mrrPorPlan.map((m) => (
              <li key={m.plan}>
                <div className="gx-adm-ingresos-mrrhead">
                  <span className="gx-adm-ingresos-mrrname">{t(`plan.${m.plan}`)}</span>
                  <span className="gx-adm-ingresos-mrrcount">
                    {m.clientes} {t('ingresos.clientes')}
                  </span>
                  <span className="gx-adm-ingresos-mrrval">{fmtUsd(m.mrr)}</span>
                </div>
                <div className="gx-adm-meter" aria-hidden="true">
                  <span
                    className="gx-adm-meter__fill"
                    style={{ width: pctWidth(m.mrr, maxMrr), background: PLAN_COLOR[m.plan] }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Margen del negocio — donut */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('ingresos.margin_title')}</span>
          <div className="gx-adm-ingresos-donutwrap">
            <div className="gx-adm-ingresos-donut" style={{ '--deg': donutDeg } as CSSProperties}>
              <span className="gx-adm-ingresos-donutlabel">{data.margenPct}%</span>
            </div>
            <ul className="gx-adm-ingresos-legend">
              <li>
                <span className="gx-adm-dot" style={{ background: '#3FB07A' }} />
                <span>{t('ingresos.leg_ingresos')}</span>
                <span className="gx-adm-ingresos-legendval">{fmtUsd(data.ingresos)}</span>
              </li>
              <li>
                <span className="gx-adm-dot" style={{ background: '#E0738A' }} />
                <span>{t('ingresos.leg_costos')}</span>
                <span className="gx-adm-ingresos-legendval gx-adm-neg">−{fmtUsd(data.costos)}</span>
              </li>
              <li>
                <span className="gx-adm-dot" style={{ background: '#C9A14E' }} />
                <span>{t('ingresos.leg_utilidad')}</span>
                <span className="gx-adm-ingresos-legendval">{fmtUsd(data.utilidadBruta)}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      {/* Costos de infraestructura · 30 días */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('ingresos.infra_title')}</span>
        <ul className="gx-adm-ingresos-infra">
          {data.costosInfra.map((c) => (
            <li key={c.label}>
              <span>{t(c.label)}</span>
              <span className="gx-adm-ingresos-infraqty">{c.cantidad}</span>
              <span className="gx-adm-ingresos-infracost">{fmtUsd(c.costoUsd)}</span>
            </li>
          ))}
          <li className="gx-adm-ingresos-infratotal">
            <span>{t('common.total')}</span>
            <span className="gx-adm-ingresos-infraqty" />
            <span className="gx-adm-ingresos-infracost">
              {fmtUsd(data.costosInfraTotal)}
              {t('common.mo')}
            </span>
          </li>
        </ul>
      </section>

      {/* Facturas */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('ingresos.fact_title')}</span>
        <div className="gx-adm-ingresos-filters">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              className="gx-adm-ingresos-chip"
              data-active={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(`ingresos.f_${f}`)}
            </button>
          ))}
        </div>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table">
            <thead>
              <tr>
                <th>{t('ingresos.th_fecha')}</th>
                <th>{t('ingresos.th_folio')}</th>
                <th>{t('ingresos.th_cliente')}</th>
                <th>{t('ingresos.th_monto')}</th>
                <th>{t('ingresos.th_estado')}</th>
                <th aria-label={t('ingresos.download')} />
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.folio}>
                  <td className="gx-adm-mono">{fmtDate(lang, f.fecha)}</td>
                  <td className="gx-adm-mono">{f.folio}</td>
                  <td>{clientById.get(f.clienteId) ?? f.clienteId}</td>
                  <td className="gx-adm-mono">{fmtUsd(f.montoUsd)}</td>
                  <td>
                    <span className="gx-adm-status" style={{ color: ESTADO_COLOR[f.estado] }}>
                      <span className="gx-adm-status__dot" style={{ background: ESTADO_COLOR[f.estado] }} />
                      {t(ESTADO_KEY[f.estado])}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="gx-adm-ingresos-dl"
                      onClick={() => showToast(`${t('ingresos.download_toast')} ${f.folio}`)}
                    >
                      {t('ingresos.download')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {facturas.length === 0 && <p className="gx-adm-ingresos-empty">{t('ingresos.empty')}</p>}
        </div>
      </section>
    </div>
  );
}
