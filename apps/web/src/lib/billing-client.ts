import { getJson, sendJson } from './http';

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

const base = (orgId: string) => `/orgs/${orgId}/subscription`;

export const httpBillingClient: BillingClient = {
  getSubscription: (orgId) => getJson(base(orgId), 'Could not load the subscription.'),
  changePlan: (orgId, input) => sendJson('PATCH', base(orgId), input, 'Could not change the plan.'),
  updateSeats: (orgId, seats) => sendJson('PATCH', `${base(orgId)}/seats`, { seats }, 'Could not update seats.'),
  checkout: (orgId) => sendJson('POST', `${base(orgId)}/checkout`, {}, 'Could not start checkout.'),
  confirmCheckout: (orgId) => sendJson('POST', `${base(orgId)}/checkout/confirm`, {}, 'Could not confirm checkout.'),
  cancel: (orgId) => sendJson('POST', `${base(orgId)}/cancel`, {}, 'Could not cancel the subscription.'),
};
