import type { AgentRuntimeStatus, AgentSlot } from '@gilgamesh/domain';
import { readCsrfToken } from './csrf';
import { API_BASE, ok } from './http';

export interface AgentRoomAgent {
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

export const httpAgentsClient: AgentsClient = {
  async getAgentRoom(projectId) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agents`, { credentials: 'include' });
    return ok<AgentRoomData>(res, 'Could not load the agent room.');
  },
  async setAgent(projectId, slot, patch) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agents/${slot}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    return ok<AgentRoomAgent>(res, 'Could not update the agent.');
  },
  async wakeAll(projectId) {
    const res = await fetch(`${API_BASE}/projects/${projectId}/agents/wake-all`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
    });
    return ok<{ awake: number; total: number }>(res, 'Could not awaken the team.');
  },
};
