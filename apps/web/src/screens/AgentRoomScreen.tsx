import { useCallback, useEffect, useState } from 'react';
import { AgentCard, portraitFor } from '@gilgamesh/ui';
import type { AgentSlot } from '@gilgamesh/domain';
import type { AgentRoomData, AgentsClient } from '../lib/agents-client';

export interface AgentRoomScreenProps {
  client: AgentsClient;
  projectId: string;
  onOpenAgent?: (slot: AgentSlot) => void;
  onChatAgent?: (slot: AgentSlot) => void;
  onGoToCanvas?: () => void;
}

function Kpi({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="gx-card gx-kpi">
      <span className="gx-kpi__label">{label}</span>
      <span className="gx-kpi__value">{value}</span>
      {bar !== undefined && (
        <span className="gx-kpi__bar">
          <span style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </span>
      )}
    </div>
  );
}

export function AgentRoomScreen({
  client,
  projectId,
  onOpenAgent,
  onChatAgent,
  onGoToCanvas,
}: AgentRoomScreenProps) {
  const [data, setData] = useState<AgentRoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await client.getAgentRoom(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the agent room.');
    }
  }, [client, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(slot: AgentSlot, nextEnabled: boolean) {
    setActionError(null);
    try {
      const updated = await client.setAgent(projectId, slot, { enabled: nextEnabled });
      setData((d) => {
        if (!d) return d;
        const agents = d.agents.map((a) => (a.slot === slot ? updated : a));
        return { ...d, agents, kpis: { ...d.kpis, awake: agents.filter((a) => a.enabled).length } };
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the agent.');
    }
  }

  async function wakeAll() {
    setActionError(null);
    setBusy(true);
    try {
      await client.wakeAll(projectId);
      setData((d) =>
        d
          ? {
              ...d,
              agents: d.agents.map((a) => ({
                ...a,
                enabled: true,
                status: a.status === 'BUSY' ? 'BUSY' : 'ACTIVE',
              })),
              kpis: { ...d.kpis, awake: d.agents.length },
            }
          : d,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not awaken the team.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="gx-room">
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="gx-room">
        <p>Loading…</p>
      </main>
    );
  }

  const counts = {
    active: data.agents.filter((a) => a.status === 'ACTIVE').length,
    busy: data.agents.filter((a) => a.status === 'BUSY').length,
    idle: data.agents.filter((a) => a.status === 'IDLE').length,
  };

  return (
    <main className="gx-room">
      <header className="gx-room__head">
        <div>
          <h1 className="gx-room__title">Agent room</h1>
          <p className="gx-room__sub">
            {data.agents.length} agents · {data.project.name}
          </p>
        </div>
        <div className="gx-room__actions">
          <button type="button" className="gx-btn gx-btn--secondary" onClick={onGoToCanvas}>
            Go to canvas →
          </button>
          <button type="button" className="gx-btn gx-btn--primary" onClick={() => void wakeAll()} disabled={busy}>
            {busy ? 'Awakening…' : 'Awaken team'}
          </button>
        </div>
      </header>

      {actionError && (
        <p role="alert" className="gx-room__error gx-login__error">
          {actionError}
        </p>
      )}

      <div className="gx-room__kpis">
        <Kpi
          label="Agents awake"
          value={`${data.kpis.awake} / ${data.kpis.total}`}
          bar={data.kpis.total ? (data.kpis.awake / data.kpis.total) * 100 : 0}
        />
        <Kpi label="Runs today" value="—" />
        <Kpi
          label="Success rate"
          value={data.kpis.successRatePct == null ? '—' : `${data.kpis.successRatePct}%`}
          bar={data.kpis.successRatePct ?? 0}
        />
        <Kpi label="Scenarios" value={String(data.kpis.scenarios)} />
      </div>

      <div className="gx-room__agentshead">
        <h2 className="gx-room__agentstitle">Agents</h2>
        <div className="gx-room__legend">
          <span>
            <i style={{ background: 'var(--green)' }} />
            {counts.active} active
          </span>
          <span>
            <i style={{ background: 'var(--amber)' }} />
            {counts.busy} busy
          </span>
          <span>
            <i style={{ background: 'var(--gray)' }} />
            {counts.idle} idle
          </span>
        </div>
      </div>

      <ul className="gx-room__grid">
        {data.agents.map((a) => (
          <li key={a.slot}>
            <AgentCard
              slot={a.slot}
              deityName={a.deityName}
              role={a.role}
              culture={a.culture}
              glyph={a.glyph}
              familyColor={a.familyColor}
              tool={a.tool}
              status={a.status}
              enabled={a.enabled}
              portraitSrc={portraitFor(a.slot)}
              onToggle={(next) => void toggle(a.slot, next)}
              onWake={() => void toggle(a.slot, true)}
              onOpen={onOpenAgent ? () => onOpenAgent(a.slot) : undefined}
              onChat={onChatAgent ? () => onChatAgent(a.slot) : undefined}
            />
          </li>
        ))}
        <li>
          <div className="gx-together">
            <span className="gx-together__title">They work as one</span>
            <span className="gx-together__sub">
              Orchestrate the whole team on the canvas and run your tests end to end.
            </span>
            <button type="button" className="gx-btn gx-btn--primary" onClick={onGoToCanvas}>
              Go to canvas →
            </button>
          </div>
        </li>
      </ul>
    </main>
  );
}
