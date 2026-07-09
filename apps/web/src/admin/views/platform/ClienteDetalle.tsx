import { useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import { ESTADO_COLOR, PLAN_COLOR } from '../../data/mock';
import type { EstadoCliente, EstadoFactura, Kpi } from '../../data/types';
import { fmtDate, fmtNum, fmtUsd, pctWidth, relTime } from '../../util';
import { FormatoChip, exitoColor } from './Proyectos';
import './ClienteDetalle.css';

const FAC_COLOR: Record<EstadoFactura, string> = { pagada: '#3FB07A', pendiente: '#C08A2E', vencida: '#E0738A' };
const FAC_LABEL: Record<EstadoFactura, string> = { pagada: 'cd.fe_pagada', pendiente: 'cd.fe_pendiente', vencida: 'cd.fe_vencida' };
const TWOFA_COLOR = { activa: '#3FB07A', pendiente: '#C08A2E' } as const;

/** KPI value: "14 / 20" renders a big "14" + a muted " / 20"; a plain value renders whole. */
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

export function ClienteDetalle() {
  const { t, lang, service, showToast, setSelProject } = useAdmin();
  const navigate = useNavigate();
  const { id } = useParams();
  const detalle = service.getCliente(id ?? '');
  const [estado, setEstado] = useState<EstadoCliente>(detalle?.cliente.estado ?? 'activo');

  if (!detalle) {
    return (
      <div className="gx-adm-page">
        <button type="button" className="gx-adm-link" onClick={() => navigate('/admin/clientes')}>
          ← {t('cd.back')}
        </button>
        <div className="gx-adm-card gx-adm-comingsoon">
          <p className="gx-adm-comingsoon__msg">{t('cd.notfound')}</p>
        </div>
      </div>
    );
  }

  const c = detalle.cliente;

  const toggleSuspend = () => {
    const next: EstadoCliente = estado === 'suspendido' ? 'activo' : 'suspendido';
    setEstado(next);
    showToast(next === 'suspendido' ? t('cd.toast_suspended') : t('cd.toast_reactivated'));
  };

  const openProyecto = (pId: string) => {
    setSelProject(pId);
    navigate(`/admin/proyectos/${pId}`, { state: { from: 'cliente', clienteId: c.id } });
  };

  return (
    <div className="gx-adm-page gx-adm-cd">
      <button type="button" className="gx-adm-link gx-adm-cd__backlink" onClick={() => navigate('/admin/clientes')}>
        ← {t('cd.back')}
      </button>

      {/* Hero — always the dark navy gradient */}
      <section className="gx-adm-hero gx-adm-cd__hero">
        <div className="gx-adm-cd__herotop">
          <span className="gx-adm-cd__abbr" style={{ background: c.color }}>
            {c.abbr}
          </span>
          <div className="gx-adm-cd__herometa">
            <div className="gx-adm-cd__nrow">
              <span className="gx-adm-cd__name">{c.nombre}</span>
              <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': PLAN_COLOR[c.plan] } as CSSProperties}>
                {t(`plan.${c.plan}`)}
              </span>
              <span className="gx-adm-status" style={{ color: ESTADO_COLOR[estado] }}>
                <span className="gx-adm-status__dot" style={{ background: ESTADO_COLOR[estado] }} />
                {t(`estado.${estado}`)}
              </span>
            </div>
            <span className="gx-adm-cd__sub">
              {c.dominio} · {c.contacto} · {t('cd.since')} {fmtDate(lang, c.clienteDesde)}
            </span>
            <div className="gx-adm-cd__mrr">
              {fmtUsd(c.mrr)}
              <span className="gx-adm-cd__mrrunit"> {t('common.mo')}</span>
            </div>
            <div className="gx-adm-cd__actions">
              <button type="button" className="gx-adm-cd__btn gx-adm-cd__btn--gold" onClick={() => showToast(t('cd.toast_plan'))}>
                {t('cd.action_plan')}
              </button>
              <button type="button" className="gx-adm-cd__btn gx-adm-cd__btn--danger" onClick={toggleSuspend}>
                {estado === 'suspendido' ? t('cd.reactivate') : t('cd.suspend')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5 KPIs (incl. margen — platform-only) */}
      <div className="gx-adm-kpirow">
        {detalle.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Cycle usage — 4 bars */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('cd.uso_title')}</span>
        <ul className="gx-adm-cd__uso">
          {detalle.usoCiclo.map((b) => (
            <li className="gx-adm-cd__usorow" key={b.label}>
              <div className="gx-adm-cd__usohead">
                <span className="gx-adm-cd__usolabel">{t(b.label)}</span>
                <span className="gx-adm-cd__usoval">
                  {fmtNum(b.valor)} / {fmtNum(b.limite)}
                </span>
              </div>
              <span className="gx-adm-meter" aria-hidden="true">
                <span className="gx-adm-meter__fill" style={{ width: pctWidth(b.valor, b.limite), background: b.color }} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Client projects (clickable → project detail) */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('cd.proyectos_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-cd__ptable">
            <thead>
              <tr>
                <th>{t('cd.pr_proyecto')}</th>
                <th>{t('cd.pr_formato')}</th>
                <th>{t('cd.pr_runs')}</th>
                <th>{t('cd.pr_exito')}</th>
                <th>{t('cd.pr_costo')}</th>
                <th>{t('cd.pr_ultima')}</th>
              </tr>
            </thead>
            <tbody>
              {detalle.proyectos.map((p) => (
                <tr
                  key={p.id}
                  className="gx-adm-cd__prow"
                  onClick={() => openProyecto(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openProyecto(p.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  data-testid={`cd-prow-${p.id}`}
                >
                  <td className="gx-adm-cd__pname">{p.nombre}</td>
                  <td>
                    <FormatoChip formato={p.formato} t={t} />
                  </td>
                  <td className="gx-adm-mono">{fmtNum(p.runs30d)}</td>
                  <td className="gx-adm-mono" style={{ color: exitoColor(p.exitoPct) }}>
                    {p.exitoPct}%
                  </td>
                  <td className="gx-adm-mono">{fmtUsd(p.costo30d)}</td>
                  <td className="gx-adm-mono gx-adm-cd__muted">{relTime(lang, p.ultimaEjecucion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent invoices */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('cd.facturas_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-cd__ftable">
            <thead>
              <tr>
                <th>{t('cd.fac_fecha')}</th>
                <th>{t('cd.fac_folio')}</th>
                <th>{t('cd.fac_monto')}</th>
                <th>{t('cd.fac_estado')}</th>
              </tr>
            </thead>
            <tbody>
              {detalle.facturas.map((f) => (
                <tr key={f.folio}>
                  <td className="gx-adm-mono gx-adm-cd__muted">{fmtDate(lang, f.fecha)}</td>
                  <td className="gx-adm-mono">{f.folio}</td>
                  <td className="gx-adm-mono">{fmtUsd(f.montoUsd)}</td>
                  <td>
                    <span className="gx-adm-status" style={{ color: FAC_COLOR[f.estado] }}>
                      <span className="gx-adm-status__dot" style={{ background: FAC_COLOR[f.estado] }} />
                      {t(FAC_LABEL[f.estado])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Workspace team */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('cd.equipo_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-cd__etable">
            <thead>
              <tr>
                <th>{t('cd.eq_nombre')}</th>
                <th>{t('cd.eq_correo')}</th>
                <th>{t('cd.eq_rol')}</th>
                <th>{t('cd.eq_2fa')}</th>
                <th>{t('cd.eq_actividad')}</th>
              </tr>
            </thead>
            <tbody>
              {detalle.equipo.map((m) => (
                <tr key={m.correo}>
                  <td className="gx-adm-cd__pname">{m.nombre}</td>
                  <td className="gx-adm-mono gx-adm-cd__muted">{m.correo}</td>
                  <td>{t(m.rol)}</td>
                  <td>
                    <span className="gx-adm-status" style={{ color: TWOFA_COLOR[m.dosFA] }}>
                      <span className="gx-adm-status__dot" style={{ background: TWOFA_COLOR[m.dosFA] }} />
                      {t(`twofa.${m.dosFA}`)}
                    </span>
                  </td>
                  <td className="gx-adm-mono gx-adm-cd__muted">{m.ultimaActividad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
