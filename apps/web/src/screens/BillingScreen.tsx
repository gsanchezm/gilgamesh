import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BillingClient, BillingCycle, Plan, SubscriptionView } from '../lib/billing-client';

export interface BillingScreenProps {
  client: BillingClient;
  orgId: string;
}

const PLANS: Plan[] = ['FREE', 'STARTER', 'GROWTH', 'SCALE'];

const PLAN_COPY: Record<Plan, { name: string; summary: string; accent: string }> = {
  FREE: { name: 'Free', summary: '1 workspace · 2 services · 500 executions', accent: 'Entry' },
  STARTER: { name: 'Starter', summary: 'Unlimited workspaces · 5 services · 3 users', accent: 'Early teams' },
  GROWTH: { name: 'Growth', summary: '15 services · 25k executions · unlimited users', accent: 'Most popular' },
  SCALE: { name: 'Scale', summary: '10 workspaces included · unlimited execution', accent: 'Scale base' },
};

function money(cents: number): string {
  return cents === 0 ? '$0' : `$${Math.round(cents / 100)}`;
}

function limit(value: number, unlimitedLabel = 'Unlimited'): string {
  return value >= 1_000_000 ? unlimitedLabel : value.toLocaleString();
}

function planName(plan: Plan): string {
  return PLAN_COPY[plan].name;
}

export function BillingScreen({ client, orgId }: BillingScreenProps) {
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan>('FREE');
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [workspaces, setWorkspaces] = useState('1');

  const load = useCallback(async () => {
    try {
      const s = await client.getSubscription(orgId);
      setSub(s);
      setPlan(s.plan);
      setCycle(s.billingCycle);
      setWorkspaces(String(s.seats));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load billing.');
    }
  }, [client, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<SubscriptionView>) {
    setError(null);
    setBusy(true);
    try {
      const next = await fn();
      setSub(next);
      setPlan(next.plan);
      setCycle(next.billingCycle);
      setWorkspaces(String(next.seats));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const selectedCopy = PLAN_COPY[plan];
  const usagePct = useMemo(() => {
    if (!sub || sub.unlimited) return 0;
    return Math.min(100, Math.round((sub.runMinutesUsed / sub.runMinutesQuota) * 100));
  }, [sub]);

  const changePlan = () => action(() => client.changePlan(orgId, { plan, billingCycle: cycle }));
  const saveWorkspaces = () => action(() => client.updateSeats(orgId, Number(workspaces)));
  const cancel = () => action(() => client.cancel(orgId));
  const checkout = () =>
    action(async () => {
      await client.checkout(orgId);
      return client.confirmCheckout(orgId);
    });

  if (error && sub === null) {
    return (
      <main className="gx-billing">
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      </main>
    );
  }

  if (sub === null) {
    return (
      <main className="gx-billing">
        <p className="gx-billing__loading">Loading...</p>
      </main>
    );
  }

  return (
    <main className="gx-billing">
      <header className="gx-billing__hero">
        <div>
          <p className="gx-billing__eyebrow">Subscription</p>
          <h1>Billing</h1>
          <p className="gx-billing__meta">
            {planName(sub.plan)} · {sub.status} · {sub.billingCycle}
          </p>
        </div>
        <div className="gx-billing__price">
          <span>{money(sub.priceCents)}</span>
          <small>{sub.billingCycle === 'ANNUAL' ? '/mo billed annually' : '/mo'}</small>
        </div>
      </header>

      {error && (
        <p role="alert" className="gx-login__error gx-billing__alert">
          {error}
        </p>
      )}

      <section className="gx-billing__summary" aria-label="Subscription summary">
        <article>
          <span>Active workspaces</span>
          <strong>
            {sub.seats} / {limit(sub.maxSeats)}
          </strong>
        </article>
        <article>
          <span>Services per workspace</span>
          <strong>{limit(sub.maxServicesPerWorkspace)}</strong>
        </article>
        <article>
          <span>Users per workspace</span>
          <strong>{limit(sub.maxUsersPerWorkspace)}</strong>
        </article>
      </section>

      <section className="gx-billing__panel" aria-label="Monthly executions">
        <div className="gx-billing__panelhead">
          <div>
            <h2>Monthly executions</h2>
            <p>
              {sub.unlimited
                ? `${sub.runMinutesUsed.toLocaleString()} used · unlimited`
                : `${sub.runMinutesUsed.toLocaleString()} / ${sub.runMinutesQuota.toLocaleString()} used`}
            </p>
          </div>
          <span>{sub.unlimited ? 'Unlimited' : `${usagePct}%`}</span>
        </div>
        <div className="gx-billing__meter" aria-hidden="true">
          <span style={{ width: sub.unlimited ? '100%' : `${usagePct}%` }} />
        </div>
      </section>

      <section className="gx-billing__plans" aria-label="Plan options">
        {PLANS.map((p) => (
          <button
            key={p}
            type="button"
            className={`gx-billing__plan${plan === p ? ' gx-billing__plan--selected' : ''}`}
            aria-pressed={plan === p}
            onClick={() => setPlan(p)}
          >
            <span>{PLAN_COPY[p].accent}</span>
            <strong>{PLAN_COPY[p].name}</strong>
            <small>{PLAN_COPY[p].summary}</small>
          </button>
        ))}
      </section>

      <section className="gx-billing__controls" aria-label="Subscription controls">
        <label className="gx-billing__field">
          <span>Selected plan</span>
          <select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_COPY[p].name}
              </option>
            ))}
          </select>
        </label>

        <label className="gx-billing__field">
          <span>Billing cycle</span>
          <select
            aria-label="Billing cycle"
            value={cycle}
            onChange={(e) => setCycle(e.target.value as BillingCycle)}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="ANNUAL">Annual</option>
          </select>
        </label>

        <label className="gx-billing__field">
          <span>Active workspaces</span>
          <input
            aria-label="Active workspaces"
            inputMode="numeric"
            value={workspaces}
            onChange={(e) => setWorkspaces(e.target.value)}
          />
        </label>

        <div className="gx-billing__actions">
          <button type="button" className="gx-btn gx-btn--primary" onClick={changePlan} disabled={busy}>
            Save plan
          </button>
          <button type="button" className="gx-btn gx-btn--secondary" onClick={saveWorkspaces} disabled={busy}>
            Update workspaces
          </button>
          <button type="button" className="gx-btn gx-btn--secondary" onClick={checkout} disabled={busy}>
            {busy ? 'Working...' : 'Checkout'}
          </button>
          <button type="button" className="gx-billing__cancel" onClick={cancel} disabled={busy}>
            Cancel subscription
          </button>
        </div>
      </section>

      <p className="gx-billing__note">
        {selectedCopy.name} includes {selectedCopy.summary.toLowerCase()}.
        {plan === 'SCALE' ? ' Extra workspaces are $99/month each after the first 10.' : ''}
      </p>
    </main>
  );
}
