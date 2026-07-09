import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import { AGENTE_COLOR } from '../../data/mock';
import type { Formato, Lang, ProyectoRow } from '../../data/types';
import { fmtNum, fmtUsd, relTime } from '../../util';
import './Proyectos.css';

/** Agent id → deity name (design handoff roster). Proper nouns — not translated. */
export const AGENT_NAME: Record<string, string> = {
  lead: 'Zeus',
  arch: 'Athena',
  manual: 'Anubis',
  web: 'Quetzalcóatl',
  api: 'Iris',
  android: 'Freya',
  ios: 'Isis',
  perf: 'Thor',
  visual: 'Xochiquetzal',
  sec: 'Odin',
  a11y: 'Ra',
};

/** Formato chip colour: BDD gold / Casos blue (README §4.6). */
const FORMATO_COLOR: Record<Formato, string> = { bdd: '#C9A14E', cases: '#3F6FA3' };

/** Success-rate colour thresholds (README §4.6). */
export function exitoColor(pct: number): string {
  if (pct >= 94) return '#3FB07A';
  if (pct >= 90) return '#C08A2E';
  return '#E0738A';
}

export function AgentPills({ ids }: { ids: string[] }) {
  return (
    <div className="gx-adm-prj__agents">
      {ids.map((id) => (
        <span className="gx-adm-prj__agent" key={id}>
          <span className="gx-adm-prj__adot" style={{ background: AGENTE_COLOR[id] ?? '#9AA0AC' }} />
          {AGENT_NAME[id] ?? id}
        </span>
      ))}
    </div>
  );
}

export function FormatoChip({ formato, t }: { formato: Formato; t: (k: string) => string }) {
  return (
    <span className="gx-adm-chip gx-adm-chip--cat" style={{ '--chip': FORMATO_COLOR[formato] } as CSSProperties}>
      {t(`formato.${formato}`)}
    </span>
  );
}

function ProyectoRowView({ p, onOpen, t, lang }: { p: ProyectoRow; onOpen: () => void; t: (k: string) => string; lang: Lang }) {
  return (
    <tr
      className="gx-adm-prj__row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      data-testid={`prj-row-${p.id}`}
    >
      <td className="gx-adm-prj__pname">{p.nombre}</td>
      <td>
        <div className="gx-adm-prj__client">
          <span className="gx-adm-chip" style={{ background: p.clienteColor }}>
            {p.clienteAbbr}
          </span>
          <span className="gx-adm-prj__cname">{p.clienteNombre}</span>
        </div>
      </td>
      <td>
        <FormatoChip formato={p.formato} t={t} />
      </td>
      <td>
        <AgentPills ids={p.agentes} />
      </td>
      <td className="gx-adm-mono">{fmtNum(p.runs30d)}</td>
      <td className="gx-adm-mono" style={{ color: exitoColor(p.exitoPct) }}>
        {p.exitoPct}%
      </td>
      <td className="gx-adm-mono">{fmtUsd(p.costo30d)}</td>
      <td className="gx-adm-mono gx-adm-prj__ultima">{relTime(lang, p.ultimaEjecucion)}</td>
    </tr>
  );
}

export function Proyectos() {
  const { t, lang, service, setSelProject } = useAdmin();
  const navigate = useNavigate();
  const rows = service.getProyectos();

  const open = (id: string) => {
    setSelProject(id);
    navigate(`/admin/proyectos/${id}`, { state: { from: 'proyectos' } });
  };

  return (
    <div className="gx-adm-page gx-adm-prj">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('proyectos.title')}</h1>
        <p className="gx-adm-sub">{t('proyectos.subtitle')}</p>
      </header>

      <section className="gx-adm-card">
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table">
            <thead>
              <tr>
                <th>{t('proyectos.h_proyecto')}</th>
                <th>{t('proyectos.h_cliente')}</th>
                <th>{t('proyectos.h_formato')}</th>
                <th>{t('proyectos.h_agentes')}</th>
                <th>{t('proyectos.h_runs')}</th>
                <th>{t('proyectos.h_exito')}</th>
                <th>{t('proyectos.h_costo')}</th>
                <th>{t('proyectos.h_ultima')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <ProyectoRowView key={p.id} p={p} t={t} lang={lang} onOpen={() => open(p.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
