import { createContext, useContext, type ReactNode } from 'react';
import { httpAgentsClient, type AgentsClient } from '../lib/agents-client';
import { httpAuthClient, type AuthClient } from '../lib/auth-client';
import { httpOnboardingClient, type OnboardingClient } from '../lib/onboarding-client';
import { httpTestLabClient, type TestLabClient } from '../lib/testlab-client';

export interface Clients {
  auth: AuthClient;
  onboarding: OnboardingClient;
  agents: AgentsClient;
  testlab: TestLabClient;
}

const defaultClients: Clients = {
  auth: httpAuthClient,
  onboarding: httpOnboardingClient,
  agents: httpAgentsClient,
  testlab: httpTestLabClient,
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
