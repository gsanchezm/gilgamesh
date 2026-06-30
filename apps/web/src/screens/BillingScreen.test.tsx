import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingClient, SubscriptionView } from '../lib/billing-client';
import { BillingScreen } from './BillingScreen';

const sub: SubscriptionView = {
  plan: 'TEAM',
  status: 'TRIALING',
  billingCycle: 'MONTHLY',
  seats: 1,
  maxSeats: 5,
  unlimited: false,
  runMinutesQuota: 1000,
  runMinutesUsed: 120,
  priceCents: 19900,
  providerCustomerId: null,
  currentPeriodEnd: null,
};

function fakeClient(overrides?: Partial<BillingClient>): BillingClient {
  return {
    getSubscription: vi.fn(async () => sub),
    changePlan: vi.fn(async (_o, input) => ({ ...sub, plan: input.plan, runMinutesQuota: 10000, maxSeats: 11 })),
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
    expect(await screen.findByText(/TEAM · TRIALING/)).toBeTruthy();
    expect(screen.getByText('120 / 1000 minutes used')).toBeTruthy();
  });

  it('changes the plan', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/TEAM · TRIALING/);
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'PRO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    await waitFor(() => expect(client.changePlan).toHaveBeenCalledWith('o1', { plan: 'PRO' }));
    expect(await screen.findByText(/PRO · TRIALING/)).toBeTruthy();
  });

  it('checks out (start + confirm) to ACTIVE', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/TEAM · TRIALING/);
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(client.confirmCheckout).toHaveBeenCalledWith('o1'));
    expect(await screen.findByText(/TEAM · ACTIVE/)).toBeTruthy();
  });

  it('surfaces a plan-change error without crashing', async () => {
    const client = fakeClient({
      changePlan: vi.fn(async () => {
        throw new Error('Current seats exceed the new plan limit; reduce seats first.');
      }),
    });
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/TEAM · TRIALING/);
    fireEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    expect((await screen.findByRole('alert')).textContent).toContain('exceed the new plan limit');
  });
});
