import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingClient, BrainUsageView, SubscriptionView } from '../lib/billing-client';
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

const zeroUsage: BrainUsageView = {
  totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
  byTier: [],
  bySurface: [],
};

const someUsage: BrainUsageView = {
  totals: { calls: 3, inputTokens: 120, outputTokens: 4567, cacheReadTokens: 0, cacheCreateTokens: 0 },
  byTier: [
    { tier: 'HAIKU', calls: 1, inputTokens: 20, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0 },
    { tier: 'SONNET', calls: 2, inputTokens: 100, outputTokens: 4537, cacheReadTokens: 0, cacheCreateTokens: 0 },
  ],
  bySurface: [
    { surface: 'CHAT', calls: 1, inputTokens: 60, outputTokens: 4000, cacheReadTokens: 0, cacheCreateTokens: 0 },
    { surface: 'ROUTER', calls: 1, inputTokens: 20, outputTokens: 30, cacheReadTokens: 0, cacheCreateTokens: 0 },
    { surface: 'GENERATE', calls: 1, inputTokens: 40, outputTokens: 537, cacheReadTokens: 0, cacheCreateTokens: 0 },
  ],
};

function fakeClient(overrides?: Partial<BillingClient>): BillingClient {
  return {
    getSubscription: vi.fn(async () => sub),
    getBrainUsage: vi.fn(async () => zeroUsage),
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

  it('shows the AI usage empty state at 0 calls (AC-METER-03 edge)', async () => {
    render(<BillingScreen client={fakeClient()} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    expect(screen.getByLabelText('AI usage')).toBeTruthy();
    expect(await screen.findByText(/No AI calls yet/)).toBeTruthy();
  });

  it('shows AI usage totals and per-surface rows when the org has calls', async () => {
    const client = fakeClient({ getBrainUsage: vi.fn(async () => someUsage) });
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    expect(client.getBrainUsage).toHaveBeenCalledWith('o1');
    expect(await screen.findByText(/120 input · 4,567 output tokens/)).toBeTruthy();
    expect(screen.getByText('3 calls')).toBeTruthy();
    expect(screen.getByText('CHAT')).toBeTruthy();
    expect(screen.getByText('ROUTER')).toBeTruthy();
    expect(screen.getByText('GENERATE')).toBeTruthy();
    expect(screen.getByText(/HAIKU 1 · SONNET 2/)).toBeTruthy();
  });

  it('an AI usage failure degrades the card without blanking the billing screen', async () => {
    const client = fakeClient({
      getBrainUsage: vi.fn(async () => {
        throw new Error('Could not load the AI usage.');
      }),
    });
    render(<BillingScreen client={client} orgId="o1" />);
    expect(await screen.findByText(/Free · TRIALING/)).toBeTruthy();
    expect(await screen.findByText('Could not load the AI usage.')).toBeTruthy();
  });

  it('shows the Scale extra-workspace pricing line from the catalog (AC-B4T-03)', async () => {
    render(<BillingScreen client={fakeClient()} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'SCALE' } });
    expect(screen.getByText(/Extra workspaces are \$99\/month each after the first 10\./)).toBeTruthy();
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
