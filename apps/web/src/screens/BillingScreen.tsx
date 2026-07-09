import { planTier } from '@gilgamesh/domain';
import { ErrorState, Spinner } from '@gilgamesh/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BillingClient,
  BillingCycle,
  BrainUsageView,
  InvoiceView,
  Plan,
  SubscriptionView,
} from '../lib/billing-client';

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

// English-only product: en-US + UTC pin the rendering (and the tests) across machines.
function invoiceAmount(inv: InvoiceView): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency.toUpperCase() }).format(
    inv.amountCents / 100,
  );
}

function invoiceDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Single source (slice 10): the Scale add-on copy derives from the canonical PLAN_CATALOG.
const SCALE_TIER = planTier('scale');

function limit(value: number, unlimitedLabel = 'Unlimited'): string {
  return value >= 1_000_000 ? unlimitedLabel : value.toLocaleString();
}

function planName(plan: Plan): string {
  return PLAN_COPY[plan].name;
}

export function BillingScreen({ client, orgId }: BillingScreenProps) {
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [usage, setUsage] = useState<BrainUsageView | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan>('FREE');
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [workspaces, setWorkspaces] = useState('1');

  // The invoices card degrades independently, like AI usage — and refreshes after a checkout.
  const loadInvoices = useCallback(async () => {
    try {
      setInvoices(await client.listInvoices(orgId));
      setInvoicesError(null);
    } catch (err) {
      setInvoicesError(err instanceof Error ? err.message : 'Could not load the invoices.');
    }
  }, [client, orgId]);

  const load = useCallback(async () => {
    // Clear a prior load error so a successful retry never leaves a stale banner (AC-ADOPT-05).
    setError(null);
    try {
      const s = await client.getSubscription(orgId);
      setSub(s);
      setPlan(s.plan);
      setCycle(s.billingCycle);
      setWorkspaces(String(s.seats));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load billing.');
    }
    // The AI usage card degrades independently — a usage failure never blanks the billing screen.
    try {
      setUsage(await client.getBrainUsage(orgId));
      setUsageError(null);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Could not load the AI usage.');
    }
    await loadInvoices();
  }, [client, orgId, loadInvoices]);

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
  // S14: the AI token allowance meter (quota lives on the subscription, not the usage endpoint).
  const aiTokensPct = useMemo(() => {
    if (!sub || sub.brainTokensUnlimited) return 0;
    return Math.min(100, Math.round((sub.brainTokensUsed / sub.brainTokensQuota) * 100));
  }, [sub]);

  // S34: open Stripe's hosted billing portal in the same tab. Not routed through `action` because it
  // returns a portal URL (not a SubscriptionView) and its success is a full-page navigation.
  const manageBilling = async () => {
    setError(null);
    setBusy(true);
    try {
      const { portalUrl } = await client.openPortal(orgId);
      window.location.href = portalUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.');
      setBusy(false);
    }
  };

  const changePlan = () => action(() => client.changePlan(orgId, { plan, billingCycle: cycle }));
  const saveWorkspaces = () => action(() => client.updateSeats(orgId, Number(workspaces)));
  const cancel = () => action(() => client.cancel(orgId));
  const checkout = () =>
    action(async () => {
      await client.checkout(orgId);
      const confirmed = await client.confirmCheckout(orgId);
      // The confirm records an invoice (mock: deterministic PAID; Stripe: via webhook) — refresh.
      await loadInvoices();
      return confirmed;
    });

  if (error && sub === null) {
    return (
      <main className="gx-billing">
        <ErrorState message={error} onRetry={() => void load()} />
      </main>
    );
  }

  if (sub === null) {
    return (
      <main className="gx-billing">
        <Spinner label="Loading billing…" />
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

      <section className="gx-billing__panel" aria-label="AI usage">
        <div className="gx-billing__panelhead">
          <div>
            <h2>AI usage</h2>
            {usage === null ? (
              <p>{usageError ?? 'Loading AI usage…'}</p>
            ) : usage.totals.calls === 0 ? (
              <p>No AI calls yet — chat with the pantheon or generate drafts to see usage here.</p>
            ) : (
              <p>
                {usage.totals.inputTokens.toLocaleString()} input · {usage.totals.outputTokens.toLocaleString()}{' '}
                output tokens
              </p>
            )}
          </div>
          {usage !== null && usage.totals.calls > 0 && <span>{usage.totals.calls.toLocaleString()} calls</span>}
        </div>
        {usage !== null && usage.totals.calls > 0 && (
          <>
            <ul className="gx-billing__aiusage">
              {usage.bySurface.map((s) => (
                <li key={s.surface}>
                  <span>{s.surface}</span>
                  <strong>{s.calls.toLocaleString()} calls</strong>
                  <small>
                    {s.inputTokens.toLocaleString()} in · {s.outputTokens.toLocaleString()} out
                  </small>
                </li>
              ))}
            </ul>
            <p className="gx-billing__aitiers">
              {usage.byTier.map((t) => `${t.tier} ${t.calls.toLocaleString()}`).join(' · ')}
            </p>
          </>
        )}
        {/* S14: the monthly token allowance meter — billable tokens (input + output) vs the plan quota. */}
        <div className="gx-billing__panelhead">
          <div>
            <p>
              {sub.brainTokensUnlimited
                ? `${sub.brainTokensUsed.toLocaleString()} AI tokens used · unlimited`
                : `${sub.brainTokensUsed.toLocaleString()} / ${sub.brainTokensQuota.toLocaleString()} AI tokens used`}
            </p>
          </div>
          <span>{sub.brainTokensUnlimited ? 'Unlimited' : `${aiTokensPct}%`}</span>
        </div>
        <div className="gx-billing__meter" aria-hidden="true">
          <span style={{ width: sub.brainTokensUnlimited ? '100%' : `${aiTokensPct}%` }} />
        </div>
      </section>

      <section className="gx-billing__panel" aria-label="Invoices">
        <div className="gx-billing__panelhead">
          <div>
            <h2>Invoices</h2>
            {invoices === null ? (
              <p>{invoicesError ?? 'Loading invoices…'}</p>
            ) : invoices.length === 0 ? (
              <p>No invoices yet — completed checkouts and provider webhooks land here.</p>
            ) : (
              <p>
                {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}
              </p>
            )}
          </div>
        </div>
        {invoices !== null && invoices.length > 0 && (
          <ul className="gx-billing__invoices">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <span>{invoiceDate(inv.createdAt)}</span>
                <strong>{invoiceAmount(inv)}</strong>
                <em className="gx-billing__invstatus" data-status={inv.status}>
                  {inv.status}
                </em>
                {inv.hostedInvoiceUrl && (
                  <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                    View invoice
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
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
          <button type="button" className="gx-btn gx-btn--secondary" onClick={manageBilling} disabled={busy}>
            Manage billing
          </button>
          <button type="button" className="gx-billing__cancel" onClick={cancel} disabled={busy}>
            Cancel subscription
          </button>
        </div>
      </section>

      <p className="gx-billing__note">
        {selectedCopy.name} includes {selectedCopy.summary.toLowerCase()}.
        {plan === 'SCALE'
          ? ` Extra workspaces are ${money(SCALE_TIER.perExtraWorkspaceCents ?? 0)}/month each after the first ${SCALE_TIER.limits.includedWorkspaces}.`
          : ''}
      </p>
    </main>
  );
}
