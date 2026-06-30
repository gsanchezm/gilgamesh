import { readCsrfToken } from './csrf';

export interface IntegrationView {
  key: string;
  name: string;
  group: string;
  connected: boolean;
  config: Record<string, unknown>;
  connectedAt: string | null;
}

export interface IntegrationsClient {
  list(orgId: string): Promise<IntegrationView[]>;
  connect(orgId: string, key: string, token: string): Promise<IntegrationView>;
  disconnect(orgId: string, key: string): Promise<IntegrationView>;
  importRepo(projectId: string, input: { fullName: string; branch?: string }): Promise<{ imported: number }>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(problem.detail ?? fallback);
  }
  return (await res.json()) as T;
}

function getJson<T>(path: string, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { credentials: 'include' }).then((r) => ok<T>(r, fallback));
}

function sendJson<T>(method: string, path: string, body: unknown, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  }).then((r) => ok<T>(r, fallback));
}

export const httpIntegrationsClient: IntegrationsClient = {
  list: (orgId) => getJson(`/orgs/${orgId}/integrations`, 'Could not load integrations.'),
  connect: (orgId, key, token) =>
    sendJson('PATCH', `/orgs/${orgId}/integrations/${key}`, { action: 'connect', token }, 'Could not connect.'),
  disconnect: (orgId, key) =>
    sendJson('PATCH', `/orgs/${orgId}/integrations/${key}`, { action: 'disconnect' }, 'Could not disconnect.'),
  importRepo: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/repo/import`, input, 'Could not import the repository.'),
};
