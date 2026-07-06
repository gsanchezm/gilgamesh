# Slice 13 — Stripe payments (Invoices + provider webhooks) (SDD Spec)

> Spec-Driven-Design spec for the thirteenth vertical slice of Gilgamesh.
> Authority order: **Keystone v0.5** (`specs/_keystone/foundation-vocabulary.md`: §1 `InvoiceStatus`,
> §2 `Invoice`, §5 `PaymentProvider`, §6 routes) → **Decisions log** → this spec.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-07-06. Status: IN PROGRESS (branch `slice-13-stripe`).

---

## 0. Owner decisions S13

- **S13-A — official `stripe` npm SDK**, server-only, pinned exact in `apps/api` (no build script →
  no `allowBuilds` change). The SDK never reaches domain/application/web.
- **S13-B — offline-first provider selection**, mirroring the slice-9 brain pattern
  (`brainFromEnv`/`resolveBrainMode`): `paymentsFromEnv` returns the deterministic
  `MockPaymentProvider` when `PAYMENTS_MODE=offline` OR `STRIPE_SECRET_KEY` is absent; otherwise the
  real `StripePaymentProvider`. **Every test suite and CI runs offline** — no suite ever calls
  stripe.com.
- **S13-C — the local `Invoice` store is the read model.** `GET /orgs/{orgId}/invoices` reads OUR
  `invoices` table (tenant-isolated), fed by provider webhooks (Stripe) or deterministically by the
  mock (`confirmCheckout` records a PAID invoice priced from the org's subscription via the domain
  `priceCents`). Both providers' `listInvoices(orgId)` (keystone §5) delegate to that same store —
  no network read on a page view.
- **S13-D — webhook truth for real Stripe:** `checkout.session.completed` (not the UI confirm
  button) is the authoritative activation; `StripePaymentProvider.confirmCheckout` merely echoes the
  provider ids the webhook already stored and fails with `VALIDATION` until it lands.

## 1. Feature intent

Real money movement behind the frozen §5 `PaymentProvider` port, with **zero UI/domain change** to
the slice-4/10 billing semantics: checkout goes to a real Stripe Checkout Session, Stripe's webhooks
land invoices in-app (keystone `Invoice` lifecycle `DRAFT | OPEN | PAID | VOID | UNCOLLECTIBLE`) and
drive `Subscription.status`, and the Billing screen lists the org's invoices.

## 2. Scope

### In scope
- **application** — `InvoiceRecord` + `InvoiceRepository` port (`listForOrg` newest-first,
  `upsertByProviderInvoiceId` = idempotent webhook redelivery) + in-memory adapter; `invoices` joins
  the `UnitOfWork` bundle; `ListInvoices` use case (MEMBER+ view; non-member → `NOT_FOUND`, never
  403); `ApplyPaymentEvent` webhook-persistence seam (UoW-atomic: invoice upsert + the subscription
  status side-effect commit together); `PaymentProvider` port extended toward the keystone
  (`listInvoices`, `handleWebhook(sig, body: Buffer)`); `MockPaymentProvider` implements both
  deterministically (`mock-signature` seam); `SubscriptionRepository.findByProviderCustomerId`
  (webhook org resolution).
- **api** — Prisma `Invoice` model + `InvoiceStatus` enum + migration (`invoices`);
  `PrismaInvoiceRepository`; both persistence wirings bind `TOKENS.Invoices` and select the provider
  via `paymentsFromEnv`; `GET /orgs/{orgId}/invoices` (authed) + `POST /billing/webhooks/{provider}`
  (`stripe` only; **unauthenticated but signature-verified over the RAW body**); a raw-body branch in
  `configureBodyParser` scoped to `/billing/webhooks` (same `JSON_BODY_LIMIT`, same 413 filter);
  `StripePaymentProvider` infra adapter (Checkout Session, `stripe.webhooks.constructEvent`,
  invoice/status upserts, org resolution via `metadata.orgId` → `providerCustomerId`).
- **web** — `BillingClient.listInvoices` + an **Invoices** section on `BillingScreen` (date, amount,
  status chip, link to `hostedInvoiceUrl` when present).
- **BDD** — `stripe-payments.feature` (AC-PAY-xx) against API+Postgres, fully offline via the mock.

### Out of scope (explicitly deferred)
- **Brain token charging / metered billing of AI usage** (flagged since slice 9).
- Stripe Customer Portal, proration, refunds/credit notes, tax; multi-currency (store is
  currency-aware, checkout charges `usd`).
- Webhook endpoint rate limiting / IP allowlisting (the guard stays opt-in by suffix; Stripe
  signature verification is the auth).
- Replacing the UI mock-confirm flow — with real Stripe the redirect+webhook path takes over
  (S13-D); the button remains for the mock.

## 3. Contract (keystone v0.5, verbatim)

- §1 `InvoiceStatus = DRAFT | OPEN | PAID | VOID | UNCOLLECTIBLE`.
- §2 `Invoice` — `id, orgId, providerInvoiceId?(unique), status, amountCents(int), currency
  (lowercase ISO-4217, default 'usd'), periodStart?, periodEnd?, hostedInvoiceUrl?, pdfUrl?,
  createdAt, updatedAt`.
- §5 `PaymentProvider` — implemented subset grows by `listInvoices(orgId)` +
  `handleWebhook(sig, body: Buffer)` (existing `createCheckout`/`confirmCheckout` unchanged;
  `getSubscription`/`updateSeats` stay deferred).
- §6 `GET /orgs/{orgId}/invoices` · `POST /billing/webhooks/{provider}` (`provider = stripe` first).

**Webhook event → keystone lifecycle mapping** (shared by mock and Stripe adapter):

| Provider event | Invoice status | Subscription side-effect |
|---|---|---|
| `invoice.finalized` | `OPEN` | — |
| `invoice.paid` | `PAID` | `ACTIVE` |
| `invoice.payment_failed` | `OPEN` | `PAST_DUE` |
| `invoice.voided` | `VOID` | — |
| `invoice.marked_uncollectible` | `UNCOLLECTIBLE` | — |
| `checkout.session.completed` (Stripe only) | — | `ACTIVE` + provider ids |
| anything else | acknowledged (200), ignored | — |

## 4. Acceptance criteria

- **AC-PAY-01** — `GET /orgs/{orgId}/invoices` returns the org's invoices newest-first to any org
  member; an org starts with none. Unauthenticated → 401.
- **AC-PAY-02** — Confirming the (mock) checkout records a deterministic **PAID** invoice priced by
  the domain `priceCents(plan, cycle, seats)` with `providerInvoiceId = in_mock_<orgId>` and a
  hosted invoice URL; re-confirming upserts the SAME row (idempotent), never a duplicate.
- **AC-PAY-03** — A signed `POST /billing/webhooks/stripe` upserts the invoice by
  `providerInvoiceId` per the §3 mapping; a redelivered/updated event mutates the same row
  (`invoice.finalized` → OPEN then `invoice.paid` → PAID = one row).
- **AC-PAY-04** — `invoice.paid` also sets the org's subscription `ACTIVE`;
  `invoice.payment_failed` sets it `PAST_DUE` — atomically with the invoice write (UoW).
- **AC-PAY-05** — The webhook route needs **no session/CSRF** (Stripe can't have one) but rejects a
  missing/invalid signature with a 4xx `Problem` and persists **nothing**. Signature verification
  runs against the raw request bytes.
- **AC-PAY-06** — Tenant isolation: a non-member listing another org's invoices → 404 (never 403);
  webhooks for an unknown `provider` → 404.
- **AC-PAY-07** — Provider selection is offline-first (S13-B): `PAYMENTS_MODE=offline` or a missing
  `STRIPE_SECRET_KEY` selects the mock; all harnesses pin `PAYMENTS_MODE=offline`.
- **AC-PAY-08** — `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` never appear in logs, thrown error
  messages, DB rows or audit metadata (unit-asserted on the adapter's failure paths).

## 5. Non-functional

- **Raw-body correctness** — the JSON parser must never consume `/billing/webhooks/*`; the raw
  branch respects `JSON_BODY_LIMIT` and oversized payloads still map to 413 `PAYLOAD_TOO_LARGE`.
- **Idempotency** — webhook redelivery (Stripe retries) is safe: upsert keyed on the unique
  `providerInvoiceId`; the update path never moves a row across orgs nor rewrites `createdAt`.
- **Determinism** — the mock stays offline/deterministic (no `Date.now`/randomness; time and ids
  flow from the injected `Clock`/`IdGenerator` via `ApplyPaymentEvent`).
- **Env vars** — `PAYMENTS_MODE` (`offline` | unset=auto), `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` (defaults point at the local
  web app's `/billing`).
