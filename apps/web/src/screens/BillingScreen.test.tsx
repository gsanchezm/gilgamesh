import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingClient, SubscriptionView } from '../lib/billing-client';
import { BillingScreen } from './BillingScreen';

const sub: SubscriptionView = {
  plan: 'FREE',
  status: 'TRIALING',
  billingCycle: 'MONTHLY',
  seats: 1,
  maxSeats: 1,
  maxServicesPerWorkspace: 2,
  maxUsersPerWorkspace: 1,
  includedWorkspaces: 1,
  unlimited: false,
  runMinutesQuota: 500,
  runMinutesUsed: 120,
  priceCents: 0,
  providerCustomerId: null,
  currentPeriodEnd: null,
};

function fakeClient(overrides?: Partial<BillingClient>): BillingClient {
  return {
    getSubscription: vi.fn(async () => sub),
    changePlan: vi.fn(async (_o, input) => ({
      ...sub,
      plan: input.plan,
      billingCycle: input.billingCycle ?? sub.billingCycle,
      runMinutesQuota: input.plan === 'GROWTH' ? 25000 : 5000,
      maxServicesPerWorkspace: input.plan === 'GROWTH' ? 15 : 5,
      maxUsersPerWorkspace: input.plan === 'STARTER' ? 3 : 1000000,
      priceCents: input.plan === 'GROWTH' ? 9900 : 2900,
    })),
    updateSeats: vi.fn(async (_o, seats) => ({ ...sub, seats })),
    checkout: vi.fn(async () => ({ checkoutUrl: 'https://mock.pay/checkout/o' })),
    confirmCheckout: vi.fn(async () => ({ ...sub, status: 'ACTIVE' })),
    cancel: vi.fn(async () => ({ ...sub, status: 'CANCELED' })),
    ...overrides,
  };
}

describe('BillingScreen', () => {
  it('loads and shows the plan, status and usage meter', async () => {
    render(<BillingScreen client={fakeClient()} orgId="o1" />);
    expect(await screen.findByText(/Free · TRIALING/)).toBeTruthy();
    expect(screen.getByText('120 / 500 used')).toBeTruthy();
  });

  it('changes the plan', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'GROWTH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(client.changePlan).toHaveBeenCalledWith('o1', { plan: 'GROWTH', billingCycle: 'MONTHLY' }));
    expect(await screen.findByText(/Growth · TRIALING/)).toBeTruthy();
  });

  it('checks out (start + confirm) to ACTIVE', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(client.confirmCheckout).toHaveBeenCalledWith('o1'));
    expect(await screen.findByText(/Free · ACTIVE/)).toBeTruthy();
  });

  it('surfaces a plan-change error without crashing', async () => {
    const client = fakeClient({
      changePlan: vi.fn(async () => {
        throw new Error('Current active workspaces exceed the new plan limit; reduce them first.');
      }),
    });
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect((await screen.findByRole('alert')).textContent).toContain('active workspaces');
  });
});
