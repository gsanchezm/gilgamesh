import type { AgentRuntimeStatus, AgentSlot } from '@gilgamesh/domain';
import { getJson, sendJson } from './http';

export interface AgentRoomAgent {
  /** Agent.id — the tile-pinned chat entry deep-links `/chat?agent=<id>` (slice 11). */
  id: string;
  slot: AgentSlot;
  deityName: string;
  role: string;
  family: string;
  familyColor: string;
  glyph: string;
  culture: string;
  tool: string;
  toolOptions: string[];
  enabled: boolean;
  status: AgentRuntimeStatus;
}

export interface AgentRoomKpis {
  awake: number;
  total: number;
  successRatePct: number | null;
  scenarios: number;
}

export interface AgentRoomData {
  project: { id: string; name: string; slug: string; format: string };
  agents: AgentRoomAgent[];
  kpis: AgentRoomKpis;
}

export interface AgentsClient {
  getAgentRoom(projectId: string): Promise<AgentRoomData>;
  setAgent(
    projectId: string,
    slot: AgentSlot,
    patch: { tool?: string; enabled?: boolean },
  ): Promise<AgentRoomAgent>;
  wakeAll(projectId: string): Promise<{ awake: number; total: number }>;
}

// Routed through the shared getJson/sendJson so getAgentRoom (a primary dashboard load) gains the
// timeout + transient-retry instead of hanging forever on a stalled API (slice 25, review F1); the
// mutations gain the timeout + typed error but are never retried (getAgentRoom is the only GET here).
export const httpAgentsClient: AgentsClient = {
  getAgentRoom: (projectId) =>
    getJson<AgentRoomData>(`/projects/${projectId}/agents`, 'Could not load the agent room.'),
  setAgent: (projectId, slot, patch) =>
    sendJson<AgentRoomAgent>(
      'PATCH',
      `/projects/${projectId}/agents/${slot}`,
      patch,
      'Could not update the agent.',
    ),
  wakeAll: (projectId) =>
    sendJson<{ awake: number; total: number }>(
      'POST',
      `/projects/${projectId}/agents/wake-all`,
      undefined,
      'Could not awaken the team.',
    ),
};
