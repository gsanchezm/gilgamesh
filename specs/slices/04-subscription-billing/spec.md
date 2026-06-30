# Slice 4 — Subscription & Billing (SDD Spec)

> Spec-Driven-Design spec for the fourth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-06-30. Status: DONE — built SDD→BDD→TDD, green end-to-end (typecheck + lint · ~281 Docker-free ·
> test:int 10 · BDD 82 scenarios · Playwright billing) on branch `slice-4-subscription-billing`. Scope:
> subscription management + run-minute quota behind a mock PaymentProvider (owner decision S4).

---

## 0. Owner decision S4

Owner picked **Subscription / billing** as slice 4. The keystone (§5) defines a `PaymentProvider` port "MOCK
now; Stripe later — no UI/domain change". **Decision S4: wire a deterministic `MockPaymentProvider` stub now**
(the Brain/Kernel-stub pattern of slices 2–3) — offline, no Stripe, no network. The real Stripe adapter, the
`Invoice` entity (`listInvoices`), and webhooks (`handleWebhook`) are deferred. This slice also **closes the
slice-3 deferred follow-up**: enforce `runMinutesQuota` on `TriggerRun` (consume `runMinutesUsed` per run).

---

## 1. Feature intent

Give a tenant control over its **plan, seats, billing cycle and run-minute usage**, behind the keystone
`PaymentProvider` port wired to a mock. An `OWNER`/`ADMIN` can **change plan**, **adjust seats**, **checkout**
(mock payment → `ACTIVE`), and **cancel**; any member can **view** the subscription + its **usage meter**. Test
runs (slice 3) now **consume run minutes** and are **blocked when the quota is exhausted** — the commercial
loop that makes execution metered.

---

## 2. Scope

### In scope
- **`PaymentProvider` port + `MockPaymentProvider` stub** (keystone §5) — `createCheckout`, `getSubscription`,
  `updateSeats`; deterministic + offline (no Stripe/network). Bound as the `PaymentProvider` token in both wirings.
- **View** — `GetOrgSubscription` (exists, slice 1) extended with the plan limits + a usage view
  (`runMinutesUsed`/`runMinutesQuota`). RBAC: any member.
- **Change plan / cycle** — `ChangeSubscription`: remaps `runMinutesQuota` + seat limit per the §9 pricing
  (TEAM 1000 min/≤5 seats · PRO 10000 min/≤11 · ENTERPRISE unlimited); rejects a downgrade whose seat max < the
  current `seats`. RBAC: `OWNER`/`ADMIN`.
- **Seats** — `UpdateSeats`: set `seats` within the plan max (over max → `VALIDATION`). RBAC: `OWNER`/`ADMIN`.
- **Checkout (mock)** — `StartCheckout` → `PaymentProvider.createCheckout` returns a `checkoutUrl`;
  `ConfirmCheckout` (mock "payment succeeded") → status `TRIALING`→`ACTIVE`, sets `providerCustomerId` /
  `providerSubscriptionId` / `currentPeriodEnd`. RBAC: `OWNER`/`ADMIN`.
- **Cancel** — `CancelSubscription`: status → `CANCELED`. RBAC: `OWNER`/`ADMIN`.
- **Quota enforcement (slice-3 closure)** — `TriggerRun` charges `runMinutes = max(1, scenarioCount)` to
  `runMinutesUsed`; if `runMinutesUsed + cost > runMinutesQuota` and the plan is not unlimited (ENTERPRISE) and
  the status is not `ACTIVE`/`TRIALING`-with-room → reject with `QUOTA_EXCEEDED` (→ HTTP 402). The charge +
  the run write commit in one `UnitOfWork` transaction.
- API (keystone §6): `GET /orgs/{id}/subscription` (extend), `PATCH /orgs/{id}/subscription` (plan/cycle/seats),
  `POST /orgs/{id}/subscription/checkout`, `POST /orgs/{id}/subscription/checkout/confirm`,
  `POST /orgs/{id}/subscription/cancel`.
- **web** — a Billing screen: plan + status + a usage meter, change-plan + seats controls, checkout + cancel
  (CSRF on mutations).
- Cross-cutting: per-`orgId` tenant isolation, RBAC, audit, validation, RFC9457 errors, both persistence
  wirings, CSRF on mutations.

### Out of scope (explicitly deferred)
- **Real Stripe** — `MockPaymentProvider` only (decision S4); no network, no API keys, no redirect.
- **`Invoice` entity + `listInvoices`** and **webhooks (`handleWebhook`)** — later billing slice.
- **Proration, payment methods, dunning, tax**, per-seat member-invite gating, usage-based overage billing.
- **SSO/identity provider** (keystone `IdentityProvider`) — unrelated.

---

## 3. Actors / personas

| Actor | Slice-4 capabilities |
|-------|----------------------|
| **Owner / Admin** (`OWNER`/`ADMIN`) | View; change plan/cycle/seats; checkout; cancel. |
| **Member** (`MEMBER`) | View subscription + usage; any mutation → `403`. |
| **Viewer** (`VIEWER`) | View subscription + usage. |
| **Non-member** | The org's subscription endpoints → `404`. |

---

## 4. Domain model (keystone names verbatim)

- **`Plan`** = `TEAM | PRO | ENTERPRISE`; **`BillingCycle`** = `MONTHLY | ANNUAL`;
  **`SubscriptionStatus`** = `TRIALING | ACTIVE | PAST_DUE | CANCELED` (all keystone).
- **`Subscription`** (exists, slice 1): `id, orgId(unique), plan, billingCycle, seats, status, runMinutesQuota,
  runMinutesUsed, providerCustomerId?, providerSubscriptionId?, currentPeriodEnd?`.
- **Plan limits (pure domain, keystone §9):** `TEAM → {runMinutesQuota: 1000, maxSeats: 5}`,
  `PRO → {10000, 11}`, `ENTERPRISE → {unlimited, large}`. A pure `planLimits(plan)` + `priceCents(plan, cycle)`
  (annual ≈ 16% off) in `packages/domain`.

### `PaymentProvider` port (keystone §5, `@gilgamesh/application` ports)
```
interface PaymentProvider {                 // MOCK now; Stripe later — no UI/domain change
  createCheckout(i: { orgId; plan; cycle; seats }): Promise<{ checkoutUrl: string }>;
  getSubscription(orgId): Promise<SubscriptionRecord>;
  updateSeats(orgId, seats): Promise<void>;
  // deferred: listInvoices, handleWebhook
}
```
`MockPaymentProvider` is deterministic + offline (no `Date.now`/`Math.random`/network): `createCheckout`
returns a stable `checkoutUrl` (`https://mock.pay/checkout/<orgId>`); confirmation mints stable
`providerCustomerId`/`providerSubscriptionId` from the orgId.

---

## 5. Acceptance criteria

- **AC-SUB-01** — A member views `GET /orgs/{id}/subscription`: plan, cycle, seats, status, and usage
  (`runMinutesUsed`/`runMinutesQuota`).
- **AC-SUB-02** — An `OWNER`/`ADMIN` changes the plan; `runMinutesQuota` + seat max remap per §9. A `MEMBER`
  → `403`.
- **AC-SUB-03** — Changing to a plan whose `maxSeats` < current `seats` is rejected (`VALIDATION`).
- **AC-SUB-04** — `UpdateSeats` within the plan max succeeds; over the max → `VALIDATION`.
- **AC-SUB-05** — `StartCheckout` returns a `checkoutUrl` via the `PaymentProvider`; `ConfirmCheckout` sets
  status `ACTIVE` + `providerCustomerId`/`providerSubscriptionId`/`currentPeriodEnd`.
- **AC-SUB-06** — `CancelSubscription` sets status `CANCELED`.
- **AC-SUB-07** — `TriggerRun` charges `max(1, scenarioCount)` minutes to `runMinutesUsed`; a run that would
  exceed `runMinutesQuota` on a non-unlimited plan → `QUOTA_EXCEEDED` (HTTP 402); ENTERPRISE is unlimited.
- **AC-SUB-08** — The annual cycle reflects the ≈16% discount in the computed price.
- **AC-SUB-09** — Tenant isolation: a non-member hitting the org's subscription endpoints → `404`.
- **AC-SUB-10** — Plan change / checkout / cancel are audited.
- **AC-SUB-11** — The `PaymentProvider` is a port; slice 4 wires a deterministic **mock** (offline, no Stripe).
- **AC-SUB-12** — The run-minute charge + the `Run` write commit atomically (one `UnitOfWork` transaction).

---

## 6. Non-functional

- **Tenant isolation** — every subscription query is `orgId`-scoped; non-members get `404` (requireOrgAccess).
- **Clean Architecture** — use cases depend only on ports (`PaymentProvider`, repos, `Clock`, `UnitOfWork`);
  the mock + Prisma adapters are wired in `apps/api`. Domain stays framework-free (fitness-test guarded).
- **Atomicity** — quota charge + run write in one transaction; plan/seat changes are single-row writes.
- **Reproducibility** — the mock provider is pure/offline; identical inputs → identical results.
- **Security** — CSRF on mutations; OWNER/ADMIN RBAC; OWASP ASVS L2; no real payment secrets (mock only).
