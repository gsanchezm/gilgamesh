import { readCsrfToken } from './csrf';

export type Plan = 'TEAM' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface SubscriptionView {
  plan: Plan;
  status: string;
  billingCycle: BillingCycle;
  seats: number;
  maxSeats: number;
  unlimited: boolean;
  runMinutesQuota: number;
  runMinutesUsed: number;
  priceCents: number;
  providerCustomerId: string | null;
  currentPeriodEnd: string | null;
}

export interface BillingClient {
  getSubscription(orgId: string): Promise<SubscriptionView>;
  changePlan(orgId: string, input: { plan: Plan; billingCycle?: BillingCycle }): Promise<SubscriptionView>;
  updateSeats(orgId: string, seats: number): Promise<SubscriptionView>;
  checkout(orgId: string): Promise<{ checkoutUrl: string }>;
  confirmCheckout(orgId: string): Promise<SubscriptionView>;
  cancel(orgId: string): Promise<SubscriptionView>;
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

const base = (orgId: string) => `/orgs/${orgId}/subscription`;

export const httpBillingClient: BillingClient = {
  getSubscription: (orgId) => getJson(base(orgId), 'Could not load the subscription.'),
  changePlan: (orgId, input) => sendJson('PATCH', base(orgId), input, 'Could not change the plan.'),
  updateSeats: (orgId, seats) => sendJson('PATCH', `${base(orgId)}/seats`, { seats }, 'Could not update seats.'),
  checkout: (orgId) => sendJson('POST', `${base(orgId)}/checkout`, {}, 'Could not start checkout.'),
  confirmCheckout: (orgId) => sendJson('POST', `${base(orgId)}/checkout/confirm`, {}, 'Could not confirm checkout.'),
  cancel: (orgId) => sendJson('POST', `${base(orgId)}/cancel`, {}, 'Could not cancel the subscription.'),
};
