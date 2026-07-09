import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import type { Kpi, TipoProyecto } from '../../data/types';
import { fmtUsd, relTime } from '../../util';
import { AgentPills, FormatoChip } from './Proyectos';
import './ProyectoDetalle.css';

const RESULTADO_COLOR = { pass: '#3FB07A', fail: '#E0738A' } as const;
const TARGET_KEY: Record<TipoProyecto, string> = { web: 'pd.target_web', android: 'pd.target_android', api: 'pd.target_api' };

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

interface BackOrigin {
  from?: string;
  clienteId?: string;
}

export function ProyectoDetalle() {
  const { t, lang, service, showToast } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const detalle = service.getProyecto(id ?? '');

  // location.state is the authoritative back-origin signal (survives even a stale selClient).
  const origin = (location.state ?? null) as BackOrigin | null;
  const fromCliente = origin?.from === 'cliente' && Boolean(origin.clienteId);

  const goBack = () => {
    if (fromCliente && origin?.clienteId) navigate(`/admin/clientes/${origin.clienteId}`);
    else navigate('/admin/proyectos');
  };

  if (!detalle) {
    return (
      <div className="gx-adm-page">
        <button type="button" className="gx-adm-link" onClick={() => navigate('/admin/proyectos')}>
          ← {t('pd.back')}
        </button>
        <div className="gx-adm-card gx-adm-comingsoon">
          <p className="gx-adm-comingsoon__msg">{t('pd.notfound')}</p>
        </div>
      </div>
    );
  }

  const p = detalle.proyecto;
  const backLabel = fromCliente ? p.clienteNombre : t('pd.back');
  const maxDesglose = Math.max(...detalle.costoDesglose.map((d) => d.valorUsd), 1);

  return (
    <div className="gx-adm-page gx-adm-pd">
      <button type="button" className="gx-adm-link gx-adm-pd__backlink" onClick={goBack}>
        ← {backLabel}
      </button>

      {/* Header */}
      <header className="gx-adm-pagehead gx-adm-pd__head">
        <div className="gx-adm-pd__titlerow">
          <h1 className="gx-adm-title">{p.nombre}</h1>
          <FormatoChip formato={p.formato} t={t} />
        </div>
        <div className="gx-adm-pd__headmeta">
          <span className="gx-adm-pd__client">
            <span className="gx-adm-chip" style={{ background: p.clienteColor }}>
              {p.clienteAbbr}
            </span>
            {p.clienteNombre}
          </span>
        </div>
        <p className="gx-adm-pd__note">{t(TARGET_KEY[p.tipo])}</p>
        <div className="gx-adm-pd__agentsrow">
          <span className="gx-adm-eyebrow gx-adm-pd__agentseyebrow">{t('pd.agentes_title')}</span>
          <AgentPills ids={p.agentes} />
        </div>
      </header>

      {/* KPIs */}
      <div className="gx-adm-kpirow">
        {detalle.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Latest runs */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('pd.ejec_title')}</span>
        {detalle.ejecuciones.length === 0 ? (
          <p className="gx-adm-comingsoon__msg">{t('pd.ejec_empty')}</p>
        ) : (
          <div className="gx-adm-tablewrap">
            <table className="gx-adm-table gx-adm-pd__runtable">
              <thead>
                <tr>
                  <th>{t('pd.ej_run')}</th>
                  <th>{t('pd.ej_fecha')}</th>
                  <th>{t('pd.ej_destino')}</th>
                  <th>{t('pd.ej_escenarios')}</th>
                  <th>{t('pd.ej_resultado')}</th>
                  <th>{t('pd.ej_duracion')}</th>
                  <th>{t('pd.ej_costo')}</th>
                  <th>{t('pd.ej_sesion')}</th>
                </tr>
              </thead>
              <tbody>
                {detalle.ejecuciones.map((e) => (
                  <tr key={e.id}>
                    <td className="gx-adm-mono gx-adm-pd__runid">{e.id}</td>
                    <td className="gx-adm-mono gx-adm-pd__muted">{relTime(lang, e.fecha)}</td>
                    <td>{t(`destino.${e.destino}`)}</td>
                    <td className="gx-adm-mono">{e.escenarios}</td>
                    <td>
                      <span className="gx-adm-status" style={{ color: RESULTADO_COLOR[e.resultado] }}>
                        <span className="gx-adm-status__dot" style={{ background: RESULTADO_COLOR[e.resultado] }} />
                        {t(`resultado.${e.resultado}`)}
                      </span>
                    </td>
                    <td className="gx-adm-mono gx-adm-pd__muted">{e.duracion}</td>
                    <td className="gx-adm-mono">{fmtUsd(e.costoUsd)}</td>
                    <td>
                      <button type="button" className="gx-adm-pd__sesion" onClick={() => showToast(t('pd.toast_sesion'))}>
                        {t('pd.ver_sesion')} →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cost · 30 days breakdown */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('pd.costo_title')}</span>
        <ul className="gx-adm-pd__costo">
          {detalle.costoDesglose.map((d) => (
            <li className="gx-adm-pd__crow" key={d.label}>
              <div className="gx-adm-pd__chead">
                <span className="gx-adm-pd__clabel">{t(d.label)}</span>
                <span className="gx-adm-pd__cval">{fmtUsd(d.valorUsd)}</span>
              </div>
              <span className="gx-adm-meter" aria-hidden="true">
                <span className="gx-adm-meter__fill" style={{ width: `${(d.valorUsd / maxDesglose) * 100}%`, background: d.color }} />
              </span>
            </li>
          ))}
        </ul>
        <div className="gx-adm-pd__total">
          <span>{t('common.total')}</span>
          <span className="gx-adm-mono">{fmtUsd(detalle.costoTotal)}</span>
        </div>
      </section>
    </div>
  );
}
