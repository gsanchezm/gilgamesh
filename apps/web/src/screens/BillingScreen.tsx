import { Button } from '@gilgamesh/ui';
import { useCallback, useEffect, useState } from 'react';
import type { BillingClient, Plan, SubscriptionView } from '../lib/billing-client';

export interface BillingScreenProps {
  client: BillingClient;
  orgId: string;
}

const PLANS: Plan[] = ['TEAM', 'PRO', 'ENTERPRISE'];

function money(cents: number): string {
  return cents === 0 ? 'Custom' : `$${(cents / 100).toFixed(0)}`;
}

export function BillingScreen({ client, orgId }: BillingScreenProps) {
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan>('TEAM');
  const [seats, setSeats] = useState('1');

  const load = useCallback(async () => {
    try {
      const s = await client.getSubscription(orgId);
      setSub(s);
      setPlan(s.plan);
      setSeats(String(s.seats));
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
      setSub(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const changePlan = () => action(() => client.changePlan(orgId, { plan }));
  const saveSeats = () => action(() => client.updateSeats(orgId, Number(seats)));
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
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="gx-billing">
      <header>
        <h1>Billing</h1>
        <p className="gx-billing__plan">
          {sub.plan} · {sub.status} · {sub.billingCycle} · {money(sub.priceCents)}/mo
        </p>
      </header>

      {error && (
        <p role="alert" className="gx-login__error">
          {error}
        </p>
      )}

      <section aria-label="Usage">
        <h2>Run-minute usage</h2>
        <p>
          {sub.unlimited
            ? `${sub.runMinutesUsed} minutes used · unlimited`
            : `${sub.runMinutesUsed} / ${sub.runMinutesQuota} minutes used`}
        </p>
        <p>
          Seats: {sub.seats} / {sub.maxSeats}
        </p>
      </section>

      <section aria-label="Change plan">
        <h2>Plan</h2>
        <select aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Button onClick={changePlan} disabled={busy}>
          Change plan
        </Button>
      </section>

      <section aria-label="Seats">
        <h2>Seats</h2>
        <input aria-label="Seats" value={seats} onChange={(e) => setSeats(e.target.value)} />
        <Button onClick={saveSeats} disabled={busy}>
          Update seats
        </Button>
      </section>

      <section aria-label="Subscription actions">
        <Button onClick={checkout} disabled={busy}>
          {busy ? 'Working…' : 'Checkout'}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={busy}>
          Cancel subscription
        </Button>
      </section>
    </main>
  );
}
