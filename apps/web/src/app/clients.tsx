import { createContext, useContext, type ReactNode } from 'react';
import { httpAgentsClient, type AgentsClient } from '../lib/agents-client';
import { httpAuthClient, type AuthClient } from '../lib/auth-client';
import { httpBillingClient, type BillingClient } from '../lib/billing-client';
import { httpIntegrationsClient, type IntegrationsClient } from '../lib/integrations-client';
import { httpKnowledgeClient, type KnowledgeClient } from '../lib/knowledge-client';
import { httpOnboardingClient, type OnboardingClient } from '../lib/onboarding-client';
import { httpRunsClient, type RunsClient } from '../lib/runs-client';
import { httpTestLabClient, type TestLabClient } from '../lib/testlab-client';

export interface Clients {
  auth: AuthClient;
  onboarding: OnboardingClient;
  agents: AgentsClient;
  testlab: TestLabClient;
  runs: RunsClient;
  billing: BillingClient;
  knowledge: KnowledgeClient;
  integrations: IntegrationsClient;
}

const defaultClients: Clients = {
  auth: httpAuthClient,
  onboarding: httpOnboardingClient,
  agents: httpAgentsClient,
  testlab: httpTestLabClient,
  runs: httpRunsClient,
  billing: httpBillingClient,
  knowledge: httpKnowledgeClient,
  integrations: httpIntegrationsClient,
};

const ClientsContext = createContext<Clients>(defaultClients);

/** Injects API clients; tests pass mocks, production uses the HTTP adapters. */
export function ClientsProvider({
  clients = defaultClients,
  children,
}: {
  clients?: Clients;
  children: ReactNode;
}) {
  return <ClientsContext.Provider value={clients}>{children}</ClientsContext.Provider>;
}

export function useClients(): Clients {
  return useContext(ClientsContext);
}
