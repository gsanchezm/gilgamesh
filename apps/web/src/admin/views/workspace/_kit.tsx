// Shared render helpers for the workspace-role views (Group D). NOT imported by routes.tsx — it wires
// views by name — so this internal kit is safe to co-locate. Everything here is COST-FREE by
// construction: it renders only the fields on the workspace-scoped view-models.
import type { CSSProperties } from 'react';
import { AGENTE_COLOR } from '../../data/mock';
import type { Formato, Kpi } from '../../data/types';

/** agent slot → deity display name (roster in design_handoff/CLAUDE.md). */
const AGENT_DEITY: Record<string, string> = {
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

/** Format chip colour (README §4.6): BDD gold / Cases blue. */
const FORMATO_COLOR: Record<Formato, string> = { bdd: '#C9A14E', cases: '#3F6FA3' };

/** KPI value: "3,420 / 5,000" reads as a big head + muted tail; a plain value renders whole. */
export function KpiValue({ value }: { value: string }) {
  const [head, ...rest] = value.split(' / ');
  if (rest.length === 0) return <span className="gx-adm-kpi__value">{value}</span>;
  return (
    <span className="gx-adm-kpi__value">
      {head}
      <span className="gx-adm-kpi__valuemuted"> / {rest.join(' / ')}</span>
    </span>
  );
}

export function KpiCard({ kpi, t }: { kpi: Kpi; t: (k: string) => string }) {
  return (
    <article className="gx-adm-kpi" data-tone={kpi.tone ?? 'default'}>
      <span className="gx-adm-kpi__label">{t(kpi.label)}</span>
      <KpiValue value={kpi.value} />
      {kpi.sub && <span className="gx-adm-kpi__sub">{t(kpi.sub)}</span>}
    </article>
  );
}

/** Format chip (BDD / Cases) — colour from the discipline literal, label via T(). */
export function FormatChip({ formato, t }: { formato: Formato; t: (k: string) => string }) {
  return (
    <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': FORMATO_COLOR[formato] } as CSSProperties}>
      {t(`formato.${formato}`)}
    </span>
  );
}

/** Assigned-agent pills — discipline-coloured dot + deity name (README §4.6). */
export function AgentPills({ agentes }: { agentes: string[] }) {
  return (
    <span className="gx-ws-pills">
      {agentes.map((slot) => (
        <span className="gx-ws-pill" key={slot}>
          <span className="gx-adm-dot" style={{ background: AGENTE_COLOR[slot] ?? '#9AA0AC' }} />
          {AGENT_DEITY[slot] ?? slot}
        </span>
      ))}
    </span>
  );
}

/** 2FA state dot (green active / amber pending). */
export function TwoFA({ state, t }: { state: 'activa' | 'pendiente'; t: (k: string) => string }) {
  return (
    <span className="gx-adm-status">
      <span className="gx-adm-status__dot" style={{ background: state === 'activa' ? '#3FB07A' : '#C08A2E' }} />
      {t(`twofa.${state}`)}
    </span>
  );
}

/** Team-role chip: Owner gold, everyone else blue (README §4.10). */
export function RolChip({ rol, t }: { rol: string; t: (k: string) => string }) {
  const color = rol === 'roles.owner' ? '#C9A14E' : '#3F6FA3';
  return (
    <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': color } as CSSProperties}>
      {t(rol)}
    </span>
  );
}
