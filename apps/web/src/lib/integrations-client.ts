import { getJson, sendJson } from './http';

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

export const httpIntegrationsClient: IntegrationsClient = {
  list: (orgId) => getJson(`/orgs/${orgId}/integrations`, 'Could not load integrations.'),
  connect: (orgId, key, token) =>
    sendJson('PATCH', `/orgs/${orgId}/integrations/${key}`, { action: 'connect', token }, 'Could not connect.'),
  disconnect: (orgId, key) =>
    sendJson('PATCH', `/orgs/${orgId}/integrations/${key}`, { action: 'disconnect' }, 'Could not disconnect.'),
  importRepo: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/repo/import`, input, 'Could not import the repository.'),
};
