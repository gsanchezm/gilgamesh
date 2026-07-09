import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingClient, BrainUsageView, InvoiceView, SubscriptionView } from '../lib/billing-client';
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
  brainTokensQuota: 100000,
  brainTokensUsed: 25000,
  brainTokensUnlimited: false,
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

const paidInvoice: InvoiceView = {
  id: 'inv-1',
  providerInvoiceId: 'in_1',
  status: 'PAID',
  amountCents: 9900,
  currency: 'usd',
  periodStart: null,
  periodEnd: null,
  hostedInvoiceUrl: 'https://mock.pay/invoice/in_1',
  pdfUrl: null,
  createdAt: '2026-07-06T12:00:00.000Z',
};

const openInvoice: InvoiceView = {
  ...paidInvoice,
  id: 'inv-2',
  providerInvoiceId: 'in_2',
  status: 'OPEN',
  amountCents: 4900,
  hostedInvoiceUrl: null,
  createdAt: '2026-06-06T12:00:00.000Z',
};

function fakeClient(overrides?: Partial<BillingClient>): BillingClient {
  return {
    getSubscription: vi.fn(async () => sub),
    getBrainUsage: vi.fn(async () => zeroUsage),
    listInvoices: vi.fn(async () => []),
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
    openPortal: vi.fn(async () => ({ portalUrl: 'https://mock.pay/portal/o1' })),
    ...overrides,
  };
}

describe('BillingScreen', () => {
  it('loads and shows the plan, status and usage meter', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    expect(await screen.findByText(/Free · TRIALING/)).toBeTruthy();
    expect(screen.getByText('120 / 500 used')).toBeTruthy();
    // Fetch-once-on-mount is unchanged by the async-state adoption.
    expect(client.getSubscription).toHaveBeenCalledTimes(1);
  });

  it('shows a Spinner while the subscription is loading', async () => {
    let resolve!: (v: SubscriptionView) => void;
    const getSubscription = vi.fn(() => new Promise<SubscriptionView>((r) => (resolve = r)));
    render(<BillingScreen client={fakeClient({ getSubscription })} orgId="o1" />);
    // Before the subscription resolves the screen shows the accessible Spinner (role="status").
    expect(screen.getByRole('status')).toBeTruthy();
    resolve(sub);
    await screen.findByText(/Free · TRIALING/);
  });

  it('shows an ErrorState with a working retry when the subscription load fails', async () => {
    const getSubscription = vi
      .fn<BillingClient['getSubscription']>()
      .mockRejectedValueOnce(new Error('Could not load billing.'))
      .mockResolvedValue(sub);
    render(<BillingScreen client={fakeClient({ getSubscription })} orgId="o1" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load billing.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/Free · TRIALING/)).toBeTruthy();
    expect(getSubscription).toHaveBeenCalledTimes(2);
    // A successful retry clears the stale error banner (AC-ADOPT-05).
    expect(screen.queryByRole('alert')).toBeNull();
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

  // ---- Slice 14: the AI token allowance meter (AC-TOKB) ----

  it('shows the AI token quota meter with used/quota and percentage (AC-TOKB-01)', async () => {
    render(<BillingScreen client={fakeClient()} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    expect(screen.getByText('25,000 / 100,000 AI tokens used')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('shows the unlimited AI token state on SCALE (AC-TOKB-06)', async () => {
    const scaleSub: SubscriptionView = {
      ...sub,
      plan: 'SCALE',
      unlimited: true,
      brainTokensQuota: 1000000000,
      brainTokensUsed: 1234567,
      brainTokensUnlimited: true,
    };
    render(<BillingScreen client={fakeClient({ getSubscription: vi.fn(async () => scaleSub) })} orgId="o1" />);
    await screen.findByText(/Scale · TRIALING/);
    expect(screen.getByText('1,234,567 AI tokens used · unlimited')).toBeTruthy();
    // Both the executions and the token meters read Unlimited on Scale.
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThanOrEqual(2);
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

  it('lists invoices with date, amount, status chip and the hosted link (AC-PAY-01)', async () => {
    const client = fakeClient({ listInvoices: vi.fn(async () => [paidInvoice, openInvoice]) });
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    expect(client.listInvoices).toHaveBeenCalledWith('o1');

    expect(await screen.findByText('$99.00')).toBeTruthy();
    expect(screen.getByText('$49.00')).toBeTruthy();
    expect(screen.getByText('PAID')).toBeTruthy();
    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(screen.getByText('Jul 6, 2026')).toBeTruthy();
    expect(screen.getByText('Jun 6, 2026')).toBeTruthy();

    // Only the invoice carrying a hostedInvoiceUrl renders a link.
    const links = screen.getAllByRole('link', { name: 'View invoice' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('https://mock.pay/invoice/in_1');
  });

  it('shows the invoices empty state', async () => {
    render(<BillingScreen client={fakeClient()} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    expect(screen.getByLabelText('Invoices')).toBeTruthy();
    expect(await screen.findByText(/No invoices yet/)).toBeTruthy();
  });

  it('an invoices failure degrades the card without blanking the billing screen', async () => {
    const client = fakeClient({
      listInvoices: vi.fn(async () => {
        throw new Error('Could not load the invoices.');
      }),
    });
    render(<BillingScreen client={client} orgId="o1" />);
    expect(await screen.findByText(/Free · TRIALING/)).toBeTruthy();
    expect(await screen.findByText('Could not load the invoices.')).toBeTruthy();
  });

  it('refreshes the invoices after a checkout confirm (AC-PAY-02)', async () => {
    const client = fakeClient();
    render(<BillingScreen client={client} orgId="o1" />);
    await screen.findByText(/Free · TRIALING/);
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(client.confirmCheckout).toHaveBeenCalledWith('o1'));
    await waitFor(() => expect(client.listInvoices).toHaveBeenCalledTimes(2));
  });

  // ---- Slice 34: Stripe billing portal ----

  it('opens the billing portal and navigates the browser to the returned URL (AC-PORTAL-01)', async () => {
    // jsdom no-ops a real location assignment; stub a writable location and restore it after.
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: '' } });
    try {
      const client = fakeClient({ openPortal: vi.fn(async () => ({ portalUrl: 'https://billing.stripe.com/p/session_9' })) });
      render(<BillingScreen client={client} orgId="o1" />);
      await screen.findByText(/Free · TRIALING/);
      fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
      await waitFor(() => expect(client.openPortal).toHaveBeenCalledWith('o1'));
      await waitFor(() => expect(window.location.href).toBe('https://billing.stripe.com/p/session_9'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original });
    }
  });

  it('surfaces a billing-portal error without navigating or crashing (AC-PORTAL-04)', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: '' } });
    try {
      const client = fakeClient({
        openPortal: vi.fn(async () => {
          throw new Error('No billing account yet — complete a checkout first.');
        }),
      });
      render(<BillingScreen client={client} orgId="o1" />);
      await screen.findByText(/Free · TRIALING/);
      fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
      expect((await screen.findByRole('alert')).textContent).toContain('No billing account yet');
      expect(window.location.href).toBe('');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original });
    }
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
