# Slice 40 — Stripe proration + refunds (programmatic)

## Summary

`ChangeSubscription` and `CancelSubscription` were pure DB-row mutations — they never called the
payment provider. Slice 34 shipped the Stripe **Customer Portal** but was deliberately "portal-only:
no programmatic refund/proration APIs." This slice adds the **programmatic path**:

- **Preview + apply proration** on a plan change (`create_prorations` — the delta rides to the next
  invoice; the preview still surfaces the signed amount).
- **Prorated refund of the unused portion** of the current period on cancel, **opt-in** via a
  `refund?: boolean` flag.

We already persist `providerCustomerId` + `providerSubscriptionId` + `currentPeriodEnd` on the
`Subscription` row, so this needs **no new Checkout Session** and **no schema migration**. The
`PaymentProvider` port is extended **additively** (the S13/S34 precedent — NO keystone amendment).

## Owner decisions

- **B-1 — proration timing = `create_prorations`.** The delta rides to the next invoice (Stripe's
  default, least surprising); the preview still shows the amount. NOT `always_invoice` (which would
  charge immediately mid-cycle).
- **B-2 — refund on cancel = prorated refund of the UNUSED portion of the current period, opt-in via
  a `refund?: boolean` flag.** In the mock it is a credit `Invoice` row (negative `amountCents`,
  status `VOID`).
- **B-3 (adapter reality) — `invoices.createPreview`, not `retrieveUpcoming`.** The installed Stripe
  SDK (22.3.0, "Basil") renamed `invoices.retrieveUpcoming` → `invoices.createPreview`. The design's
  literal method name reflects an older SDK; we use the real one. The Stripe arm is NEVER exercised
  live (unit-tested with a fake injected `Stripe`, exactly like S13/S34).

## Behavior (acceptance criteria)

- **AC-PRORATE-01** — Plan **upgrade** with an active provider subscription → `payment.changePlan` is
  called, `prorationCents > 0` (charge), the `SubscriptionView` carries it, and
  `subscription.plan_prorated` is audited with the amount.
- **AC-PRORATE-02** — Plan **downgrade** with an active provider subscription → `prorationCents < 0`
  (a credit).
- **AC-PRORATE-03** — Plan change with **no** provider subscription (still FREE / never checked out) →
  NO provider call, `prorationCents: 0`, the DB-row path is byte-for-byte unchanged (regression-safe).
- **AC-PRORATE-04** — `previewProration` returns the **same** signed amount `changePlan` would apply,
  **without** mutating any row (read-only estimate).
- **AC-PRORATE-05** — **Cancel with `refund: true`** and a paid invoice → `payment.refund` is called,
  `refundedCents` = the prorated unused amount, a credit invoice is recorded, `subscription.refunded`
  is audited, and the status becomes `CANCELED`.
- **AC-PRORATE-06** — **Cancel with `refund: false`** (the default) → no refund, no
  `subscription.refunded` audit, no `refundedCents` on the view: today's behavior byte-for-byte.
- **AC-PRORATE-07 (security)** — The Stripe secret key never appears in a view, an invoice row, an
  audit-log row, or a thrown error message (the S13 AC-PAY-08 assertion, extended to the new methods).

## Ports / adapters

- **Port** (`packages/application/src/ports/payment.ts`), additive:
  ```ts
  type ChangePlanRequest = { orgId: string; plan: Plan; cycle: BillingCycle; seats: number };
  changePlan(req: ChangePlanRequest): Promise<{ prorationCents: number }>;    // signed: +charge / -credit
  previewProration(req: ChangePlanRequest): Promise<{ prorationCents: number }>; // read-only estimate
  refund(req: { orgId: string; reason: 'cancellation' }): Promise<{ refundedCents: number }>;
  ```
- **Deterministic proration math** (`packages/domain/src/billing/proration.ts`, pure): the single
  source both arms consume — `remainingPeriodFraction(periodEnd, billingCycle, now)` (clamped 0..1)
  and `prorationAmountCents(fromCents, toCents, fraction)`.
- **Mock** (`packages/application/src/payment/mock-payment-provider.ts`, deterministic/offline — the
  only arm any suite exercises): reads the (pre-change) subscription; `previewProration`/`changePlan`
  compute `round((newPrice − oldPrice) × remainingFraction)` from domain `priceCents(...)` and the
  injected `Clock` (no `Date.now`). `changePlan` records the proration as an OPEN `Invoice` row via the
  existing `ApplyPaymentEvent` seam; `previewProration` mutates nothing. `refund` records a credit
  `Invoice` row (negative `amountCents`, status `VOID`) at the prorated unused amount and returns it.
- **Stripe adapter** (`apps/api/src/infra/stripe-payment-provider.ts`, real but never live):
  - `previewProration` → resolve the org's subscription + its single item id/product (via
    `subscriptions.retrieve`), then `invoices.createPreview({ subscription, subscription_details: {
    items: [{ id, price_data }], proration_behavior: 'create_prorations' } })`; sum the proration
    lines (`line.parent.subscription_item_details.proration` — read via a minimal local shape).
  - `changePlan` → the same preview for the amount, then `subscriptions.update(subId, { items: [{ id,
    price_data }], proration_behavior: 'create_prorations' })`. Inline `price_data` reuses the existing
    item's product id (mirrors the checkout price shape; the codebase keeps no persistent Price/Product).
  - `refund` → resolve the latest PAID invoice → `invoices.retrieve` → `refunds.create({
    payment_intent, amount })` for the prorated unused amount.
  - Secret hygiene (AC-PRORATE-07): the Stripe secret / SDK error text never surfaces in a view,
    invoice row, audit metadata, or thrown error.
- **Clock in the payment deps.** Both arms need `now` for the fraction; the payment factory already
  has `TOKENS.Clock` in scope, so `clock` is threaded into `PaymentProviderDeps`/`MockPaymentDeps`.
- **Selection unchanged:** `paymentsFromEnv` (`PAYMENTS_MODE=offline` / no `STRIPE_SECRET_KEY` → mock).

## Use cases (`packages/application/src/use-cases/subscription.ts`)

- `ChangeSubscription` — after the RBAC + workspace-cap checks, **if** the (pre-change) subscription
  has a `providerSubscriptionId`, call `payment.changePlan(...)` **before** the local `save` (so the
  provider observes the still-current row — the mock derives the old price from it; a provider failure
  then leaves the local row untouched), attach `prorationCents` to the view, audit
  `subscription.plan_prorated`. No provider sub → today's pure-row path with `prorationCents: 0`.
- `PreviewPlanChange` (new) — `requireOrgAdmin` + `requireSub`; returns
  `{ plan, billingCycle, prorationCents }` via `payment.previewProration` (0 when no provider sub).
  Read-only.
- `CancelSubscription` — gains `refund?: boolean`. When true, call `payment.refund` before flipping to
  `CANCELED`; if it refunded (`refundedCents > 0`) attach `refundedCents` and audit
  `subscription.refunded`. Default `refund: false` → today's behavior byte-for-byte.
- `SubscriptionView` gains optional `prorationCents?` / `refundedCents?` (additive).
- `INVOICE_WEBHOOK_EFFECTS` gains `charge.refunded` (→ VOID) so a real Stripe refund reflects on
  webhook redelivery, idempotent by provider-invoice id.

## API (`apps/api/src/billing/`)

- `POST /orgs/:orgId/subscription/preview` (`@HttpCode(200)`, session + CSRF) → `PreviewPlanChange`.
  Body `PreviewPlanChangeDto { plan, billingCycle? }`.
- `POST /orgs/:orgId/subscription/cancel` now accepts `CancelSubscriptionDto { refund?: boolean }`.
- `PreviewPlanChange` wired via the existing `subProvider(...)` factory.

## Web

- `billing-client.ts`: `previewProration(orgId, { plan, billingCycle? })`; `cancel(orgId, { refund })`;
  `changePlan` already returns the proration-aware `SubscriptionView`. `SubscriptionView` gains
  optional `prorationCents?` / `refundedCents?`; new `PlanChangePreview` type.
- `BillingScreen.tsx`: a **proration preview** line on the plan selector (driven by
  `previewProration` when the plan/cycle differs and a billing account exists) and a **refund**
  confirmation checkbox on Cancel ("Refund the unused ~$Z?").

## Verification (Docker-free only)

`pnpm -r typecheck` · `pnpm lint` · `pnpm -r test`. The mock is the only arm any suite exercises; the
Stripe adapter is unit-tested with a fake injected `Stripe`. e2e/BDD run under `SystemClock`, so they
assert the proration **sign** (>0 upgrade / <0 downgrade / ==0 no-provider-sub); exact-cent amounts
are pinned only in the unit tests that control `FakeClock` + `currentPeriodEnd`.

## Out of scope / deferred

- Stripe proration *scheduling* / mid-cycle immediate invoicing (`always_invoice`).
- Partial/line-level refunds, refund reason taxonomy beyond `cancellation`.
- Per-item multi-line subscriptions (we keep one line item, as checkout creates).
