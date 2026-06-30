import { useCallback, useEffect, useState } from 'react';
import { AgentTile, Button } from '@gilgamesh/ui';
import type { AgentSlot } from '@gilgamesh/domain';
import type { AgentRoomData, AgentsClient } from '../lib/agents-client';

export interface AgentRoomScreenProps {
  client: AgentsClient;
  projectId: string;
  onOpenAgent?: (slot: AgentSlot) => void;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="gx-kpi">
      <span className="gx-kpi__label">{label}</span>
      <span className="gx-kpi__value">{value}</span>
    </div>
  );
}

export function AgentRoomScreen({ client, projectId, onOpenAgent }: AgentRoomScreenProps) {
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

  return (
    <main className="gx-room">
      <header className="gx-room__head">
        <div>
          <h1 className="gx-room__title">Agent room</h1>
          <p className="gx-room__sub">
            {data.agents.length} agents · {data.project.name}
          </p>
        </div>
        <Button onClick={wakeAll} disabled={busy}>
          {busy ? 'Awakening…' : 'Awaken team'}
        </Button>
      </header>

      {actionError && (
        <p role="alert" className="gx-room__error gx-login__error">
          {actionError}
        </p>
      )}

      <div className="gx-room__kpis">
        <Kpi label="Awake" value={`${data.kpis.awake} / ${data.kpis.total}`} />
        <Kpi
          label="Success"
          value={data.kpis.successRatePct == null ? '—' : `${data.kpis.successRatePct}%`}
        />
        <Kpi label="Scenarios" value={String(data.kpis.scenarios)} />
      </div>

      <ul className="gx-room__grid">
        {data.agents.map((a) => (
          <li key={a.slot}>
            <AgentTile
              deityName={a.deityName}
              role={a.role}
              glyph={a.glyph}
              familyColor={a.familyColor}
              tool={a.tool}
              status={a.status}
              enabled={a.enabled}
              onToggle={() => void toggle(a.slot, !a.enabled)}
              onOpen={onOpenAgent ? () => onOpenAgent(a.slot) : undefined}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
