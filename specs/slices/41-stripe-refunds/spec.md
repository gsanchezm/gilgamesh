# Slice 41 — Stripe refunds (partial / amount-level) + `always_invoice` + refund preview

## Summary

Slice 40 shipped programmatic proration (`create_prorations`) and an **opt-in prorated refund of the
unused period on cancel** (a full-unused-portion credit invoice). It explicitly deferred:

- **Partial / amount-level refunds** — refund an **arbitrary** amount (goodwill, dispute, partial
  credit), not just the automatic prorated-unused amount.
- **A refund-preview endpoint** — show the exact "$Z will be refunded" before committing.
- **`always_invoice`** proration mode — invoice the proration immediately, vs the default
  `create_prorations` (rides to the next invoice).

This slice closes all three. It reuses the existing `Invoice` model (a partial refund is recorded as a
negative-`amountCents` VOID credit row, the slice-40 shape) and **the `Subscription` fields already
persisted** (`providerCustomerId`/`providerSubscriptionId`/`currentPeriodEnd`), so there is **NO schema
migration** and the `PaymentProvider` port is extended **additively** (the S13/S34/S40 precedent — NO
keystone amendment).

## Verified at spec time (per the brief)

- **Slice 40 added no `Invoice` schema change for refunds** — confirmed: the last billing migration is
  `20260706100000_invoices` (slice 13); slice 40 shipped with no migration. The `InvoiceRecord` shape
  (`id`/`orgId`/`providerInvoiceId`/`status`/`amountCents`/`currency`/periods/urls/timestamps) already
  carries everything a credit row needs. **This slice adds no migration.**
- **Default `prorationBehavior` stays `create_prorations`** — the option is absent by default; a spy
  test asserts a plain plan change never sends `always_invoice` (regression-safe).

## Owner / design decisions

- **The refundable ceiling = the (target) paid invoice's `amountCents`.** A partial refund is
  amount-level against a real paid invoice — you can never refund more than was paid on it. This is
  distinct from slice 40's *cancellation* refund (the prorated unused portion). Both coexist behind the
  one `refund` port method (see below). *(Advisor-reviewed: face-value reading of "the invoice's
  refundable ceiling"; keeps the partial path deterministic — executed == requested — with no clock.)*
- **One `refund` port method, two paths (backward-compatible):**
  - **No `amountCents`** → the slice-40 **cancellation** path (prorated unused portion). `CancelSubscription`
    still calls `refund({ orgId, reason: 'cancellation' })` — **byte-for-byte unchanged** (spy-verified).
  - **`amountCents` present** → the slice-41 **partial** path: refund exactly that amount, capped by the
    invoice ceiling. An over-ceiling request throws `VALIDATION` (→ 422).
- **One pure domain source** (`packages/domain/src/billing/proration.ts` → `quoteRefund`) shared by
  `previewRefund` and `refund`, so the previewed "$Z" always equals the charged "$Z" for a valid request.
- **Preview is lenient (read-only), execute is strict** — `previewRefund` never throws for a business
  reason: it returns `{ refundableCents (ceiling), amountCents (the request clamped to the ceiling) }`
  so the UI can show the cap. `refund` **rejects** an over-ceiling request with `VALIDATION` (the AC-03
  422). For any **valid** request (`amountCents ≤ ceiling`) the two agree exactly. (Mirrors the
  slice-40 `PreviewPlanChange`-lenient / mutation-strict split.)
- **The mock is the only arm any suite exercises** (Docker-free), so the **mock's `refund` throws
  `VALIDATION` on over-ceiling** (not a silent `{ refundedCents: 0 }`) — AC-REFUND-03 is provable
  offline. The Stripe arm throws the same. `VALIDATION → 422` is already wired
  (`domain-exception.filter.ts`).

## Behavior (acceptance criteria)

- **AC-REFUND-01** — A **partial refund** of `amountCents` (≤ the latest paid invoice) records a credit
  `Invoice` (negative `amountCents`, `VOID`) for **exactly** the requested amount and returns
  `{ refundedCents: amountCents }`.
- **AC-REFUND-02** — `previewRefund` returns the **same** `amountCents` that `refund` then charges
  (shared pure `quoteRefund` source) — for a valid request they are identical.
- **AC-REFUND-03** — A refund **beyond the refundable ceiling** → `VALIDATION` (→ 422), no credit row
  written, never a 500.
- **AC-REFUND-04** — `changePlan` with `prorationBehavior: 'always_invoice'` issues the proration
  immediately: the Stripe arm calls `subscriptions.update(..., { proration_behavior: 'always_invoice' })`;
  the **default** (option absent) stays `create_prorations` (spy-verified, regression-safe).
- **AC-REFUND-05** — RBAC + tenant isolation: OWNER/ADMIN only; a member → 403; a **non-member → 404**
  (existence not leaked); no billing account (`providerCustomerId` null) → `VALIDATION` (422).
- **AC-REFUND-06** — Security: the Stripe secret key never appears in a view, an invoice row, an
  audit-log row, or a thrown error message (the S13 AC-PAY-08 / S40 AC-PRORATE-07 assertion, extended
  to the new methods).

## Ports / adapters

- **Port** (`packages/application/src/ports/payment.ts`), additive:
  ```ts
  type ProrationBehavior = 'create_prorations' | 'always_invoice';
  interface ChangePlanRequest { orgId; plan; cycle; seats; prorationBehavior?: ProrationBehavior } // + field
  interface RefundRequest { orgId; amountCents?: number; reason?: 'cancellation' | 'manual'; invoiceId?: string }
  interface RefundPreview { refundableCents: number; amountCents: number }
  refund(req: RefundRequest): Promise<{ refundedCents: number }>;                 // amountCents present → partial
  previewRefund(req: { orgId; amountCents?; invoiceId? }): Promise<RefundPreview>; // read-only estimate
  ```
- **Pure domain** (`packages/domain/src/billing/proration.ts`): `quoteRefund(requestedCents | undefined,
  refundableCents)` → `{ refundableCents (ceiling, rounded ≥ 0), amountCents (request clamped to
  [0, ceiling]), exceedsCeiling }`. Absent request → a full refund of the ceiling; non-positive → 0.
- **Mock** (`packages/application/src/payment/mock-payment-provider.ts`): `refund` branches on
  `amountCents`. The partial path resolves the target paid invoice's amount as the ceiling, quotes via
  `quoteRefund`, throws `VALIDATION` on `exceedsCeiling`, and records a credit `Invoice`
  (`in_mock_refund_partial_<orgId>_<n>` — `n` = the count of existing partial-refund rows so repeated
  partial refunds do not collide). `previewRefund` computes the same quote, mutates nothing. The
  cancellation path (`amountCents` absent) is the slice-40 code, refactored out unchanged.
- **Stripe adapter** (`apps/api/src/infra/stripe-payment-provider.ts`, real but never live): `refund`
  branches the same way; the partial path resolves the target paid invoice → `invoices.retrieve` →
  `refunds.create({ payment_intent, amount: amountCents })`. `changePlan` threads
  `req.prorationBehavior ?? 'create_prorations'` into `subscriptions.update`. Secret hygiene: the key /
  SDK error text never surfaces (AC-REFUND-06).
- **Selection unchanged:** `paymentsFromEnv` (`PAYMENTS_MODE=offline` / no `STRIPE_SECRET_KEY` → mock).

## Use cases (`packages/application/src/use-cases/subscription.ts`)

- `RefundPayment` (new) — `requireOrgAdmin` + `requireSub` + a `providerCustomerId` guard (no billing
  account → `VALIDATION`, the `StartBillingPortal` precedent), then `payment.refund({ orgId,
  amountCents, reason: 'manual', invoiceId })`; audits `subscription.refunded` when `refundedCents > 0`.
- `PreviewRefund` (new) — `requireOrgAdmin` + `requireSub`, delegates to `payment.previewRefund`. Read-only.
- `ChangeSubscription` — gains an optional `prorationBehavior` input, threaded into `payment.changePlan`.
  Absent → `create_prorations` (regression-safe).
- `CancelSubscription` — **unchanged** (still calls `refund({ orgId, reason: 'cancellation' })`).

## API (`apps/api/src/billing/`)

- `POST /orgs/:orgId/subscription/refund` (`@HttpCode(200)`, session + CSRF) → `RefundPayment`. Body
  `RefundDto { amountCents (int ≥ 1), invoiceId? }`.
- `POST /orgs/:orgId/subscription/refund/preview` (`@HttpCode(200)`) → `PreviewRefund`. Body
  `PreviewRefundDto { amountCents? (int ≥ 1), invoiceId? }`.
- `ChangePlanDto` gains `prorationBehavior?: 'create_prorations' | 'always_invoice'`.

## Web (`apps/web/src/screens/BillingScreen.tsx`, `lib/billing-client.ts`)

- `billing-client.ts`: `previewRefund(orgId, { amountCents?, invoiceId? })`, `refund(orgId, { amountCents,
  invoiceId? })`; `changePlan` gains an optional `prorationBehavior`; new `RefundPreview`/`RefundResult`
  types.
- `BillingScreen.tsx`: a **refund** control (only with a billing account) — an amount input →
  `previewRefund` shows "$Z will be refunded" (and the ceiling) → a confirm button calls `refund`.

## Verification (Docker-free only — Tier-0 shared infra)

`pnpm -r typecheck` · `pnpm -r lint` · `pnpm -r test`. The mock is the only arm any suite exercises; the
Stripe adapter is unit-tested with a fake injected `Stripe` (never live). BDD partial refunds are
**deterministic** (executed == requested, no clock), so the `.feature` pins exact cents. `test:int` /
`test:bdd` / Playwright are run by the orchestrator, serialized.

## Out of scope / deferred

- **Netting against prior refunds** — the ceiling is the full (target) invoice amount regardless of
  earlier partial refunds, so N partials could in principle exceed the invoice. The brief does not ask
  for netting; a real Stripe refund is itself capped by the charge, and this is a mock-arm limitation.
- Line-item-level refunds; a refund reason taxonomy beyond `cancellation`/`manual`.
- `always_invoice` for `UpdateSeats` (only `ChangeSubscription` threads the behavior).
- Refund metering / a dedicated refund ledger (the credit `Invoice` row is the record).
