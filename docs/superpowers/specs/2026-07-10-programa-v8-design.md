# Programa paralelo v8 — design

**Date:** 2026-07-10 · **Owner:** Gilberto · **Cadence:** the v2–v7 parallel-program pattern
(SDD→BDD→TDD per stream in its own `pnpm wt` worktree, adversarial review, serialized stack gates,
sequential FF merges). Owner selected the tanda from a menu: **2 features, 2 worktrees.** No keystone
amendment, no schema migration to a shared vocabulary — both slices are additive.

Two disjoint domains → zero shared-file collisions (the `index.css`/`main.ts` lesson):

| Stream | Slice | Blast radius (files) |
|---|---|---|
| **A · security** | Per-IP backoff / lockout | `apps/api/src/auth/*` (new store + guard/interceptor), `app.module.ts` APP_PROVIDERS, `config.ts`, api tests, `specs/slices/39-*` |
| **B · billing** | Stripe proration + refunds | `packages/application/src/ports/payment.ts` · `use-cases/subscription.ts` · `payment/mock-payment-provider.ts` · `apps/api/src/infra/stripe-payment-provider.ts` · billing controllers/DTO · `BillingScreen`/`BillingClient` · `specs/slices/40-*` |

Slice numbers: **A = 39**, **B = 40** (continuing 1–38). The final `CLAUDE.md` + board update is done by the
orchestrator (serialized), never the subagents.

Verification rule for the subagents (Tier-0 shared Postgres/Redis/ports): **Docker-free only**
(`typecheck · lint · pnpm -r test`). The orchestrator runs the serialized `test:int` / `test:bdd` /
Playwright gates and applies any migration to the shared dev DB before those gates. (There is no migration
this round.)

---

## Slice A (39) — Per-IP backoff / lockout

### Problem
Today a single global `RateLimitGuard` (fixed window, key = `path : ip : email`, default 10/min) throttles
per-account-per-IP. It does **not** stop:
1. **Org-farming / spray** — one IP hammering `register`/`login` across *many* emails (each email is its own
   bucket, so the per-email window never trips).
2. **Credential-stuffing** — repeated *failed* logins deserve an escalating penalty, not a flat window.

The guard's own doc-comment already earmarks this exact work: *"Deferred (§10.2): a per-IP-only bound
(org-farming) and exponential-backoff account lockout (N=10)."* Audit-followup §4 flags it as "a security
feature with its own spec." This slice builds it.

### Design — two additive protections, both keyed on IP (never on account alone)
**Keying decision (anti-DoS):** the lockout is keyed on **client IP** (optionally IP+email as a secondary
counter), **never on the account globally** — locking per-account would let an attacker lock a victim out by
failing their login N times. An attacker only ever locks *their own* IP.

**A1 · Per-IP request ceiling (attempt-based, pre-handler).** A second `RateLimitStore.hit(ipOnlyKey, …)`
check inside the guard, keyed on `authScope : ip` (email excluded), with its own higher limit
(`AUTH_IP_RATE_LIMIT`, default 30/min). Catches spray across many emails. Reuses the existing store port +
adapters verbatim — no new port needed for A1.

**A2 · Exponential backoff lockout (failure-based).** A new port modeled on `RateLimitStore`:

```ts
// apps/api/src/auth/login-attempt-store.ts
export const LOGIN_ATTEMPT_STORE = 'LOGIN_ATTEMPT_STORE';
export interface LoginAttemptState { failures: number; lockedUntil: number | null; } // epoch ms
export interface LoginAttemptStore {
  recordFailure(key: string, now: number): Promise<LoginAttemptState>; // ++failures, set lockedUntil if failures >= threshold
  clear(key: string): Promise<void>;                                    // on success
  getState(key: string): Promise<LoginAttemptState>;                    // pre-handler read
}
```

- **In-memory adapter** (`Clock`-injected, mirrors `InMemoryRateLimitStore`) and **Redis adapter**
  (`REDIS_URL`-selected `useFactory`, native TTL on the lock window). Deterministic under the mutable-fake-
  clock test pattern.
- **Backoff math (pure, unit-tested):** consecutive failures below `AUTH_LOCKOUT_THRESHOLD` (default **10**,
  honoring the earmarked N=10) → no lock. At/above threshold → `lockedUntil = now + min(AUTH_LOCKOUT_MAX_MS,
  AUTH_LOCKOUT_BASE_MS * 2^(failures - threshold))`. Defaults: base 60s, max 15 min. Counter TTL resets after
  a successful login (`clear`) or after the window fully lapses.
- **Recording the outcome (HTTP-layer only, no domain change):** a `LoginOutcomeInterceptor` wraps
  `POST /auth/login` (and `POST /auth/reset-password`): success (2xx) → `store.clear(key)`; an
  `INVALID_CREDENTIALS` error in the stream → `store.recordFailure(key)` then rethrow. The domain use cases
  are untouched — the lockout is a pure adapter-layer concern.
- **The guard pre-checks the lock:** before the normal fixed-window count, on the lockout-guarded routes,
  `getState(key)` → if `lockedUntil > clock.now()` throw `RATE_LIMITED` (HTTP 429) with
  `Retry-After = ceil((lockedUntil - now)/1000)`. Existing `X-RateLimit-*` header shape preserved.

**Fail-open preserved.** A store outage degrades to *allow* (same posture as today's guard; the owner did
**not** pick the fail-open-hardening item this round, so we don't change that policy).

### Config (env, all defaulted — zero-config = sane defaults)
`AUTH_IP_RATE_LIMIT` (30) · `AUTH_IP_RATE_WINDOW_MS` (60000) · `AUTH_LOCKOUT_THRESHOLD` (10) ·
`AUTH_LOCKOUT_BASE_MS` (60000) · `AUTH_LOCKOUT_MAX_MS` (900000). Test harnesses that must disable it set the
threshold/limit high, mirroring the existing `AUTH_RATE_LIMIT=1000000` idiom.

### Acceptance criteria (AC-IPLOCK-01..07)
1. N=`threshold` consecutive failed logins from one IP → the next attempt gets **429 + Retry-After**, even
   with correct credentials (locked).
2. A **successful** login before the threshold **clears** the counter (no lock).
3. Lock window **grows exponentially** across repeated lock cycles, capped at `AUTH_LOCKOUT_MAX_MS`.
4. A **second IP** is unaffected while the first is locked (per-IP isolation → no account-DoS).
5. Per-IP **ceiling** (A1): >`AUTH_IP_RATE_LIMIT` attempts/min from one IP across *different* emails → 429
   (the per-account window would not have tripped).
6. Store outage → **fail-open** (request allowed, warning logged), not 500.
7. Reset-password failures feed the same lockout; a valid reset clears it.

### Test plan
- **Unit:** backoff math (fake clock, boundary at threshold, cap), in-memory store window/reset, interceptor
  record-on-401 / clear-on-2xx, guard lock pre-check + Retry-After.
- **e2e** (`apps/api/test/ip-lockout.e2e.test.ts`, boots `AppModule`, `REDIS_URL` deleted → in-memory,
  low thresholds via env): AC-1..6 end-to-end over `/auth/login`.
- **Redis int** (`test/integration/login-attempt.int.test.ts`): real Redis failure count + lock TTL.
- **BDD**: `specs/slices/39-ip-lockout/ip-lockout.feature`, `@wip @security` outline following the AC-AUTH-13
  convention (the sweep disables the limiter, so the executable proof is the e2e — same as AC-AUTH-13).

---

## Slice B (40) — Stripe proration + refunds

### Problem
`ChangeSubscription` and `CancelSubscription` are pure DB-row mutations today — they never call Stripe.
The Customer Portal (slice 34) was deliberately "portal-only: no programmatic refund/proration APIs." This
slice adds the programmatic path. **We already persist `providerSubscriptionId` + `providerCustomerId` on the
`Subscription` row**, so proration needs **no** new Checkout Session and **no** schema migration.

### Design — additive `PaymentProvider` methods (S13/S34 precedent, no keystone)
```ts
// packages/application/src/ports/payment.ts  (add to the interface)
changePlan(req: ChangePlanRequest): Promise<{ prorationCents: number }>;   // signed: +charge / -credit
previewProration(req: ChangePlanRequest): Promise<{ prorationCents: number }>; // read-only estimate
refund(req: { orgId: string; reason: 'cancellation' }): Promise<{ refundedCents: number }>;
```
`ChangePlanRequest = { orgId, plan, cycle, seats }`.

- **Stripe arm** (`StripePaymentProvider`):
  - `previewProration` → `stripe.invoices.retrieveUpcoming({ subscription, subscription_items:[{ id, price_data }], subscription_proration_behavior:'create_prorations' })`; returns the summed proration line amount.
  - `changePlan` → `stripe.subscriptions.update(providerSubscriptionId, { items:[{ id, price_data }], proration_behavior:'create_prorations' })` (inline `price_data`, mirroring the existing checkout — the codebase keeps no persistent Stripe Price objects). The resulting proration rides to the next invoice (see Decision B-1).
  - `refund` → resolve the latest PAID invoice → `stripe.refunds.create({ payment_intent })` for the prorated unused amount (see Decision B-2).
  - Requires a new `SubscriptionRepository.findByProviderSubscriptionId` **only if** we resolve by sub id;
    we resolve by `orgId` (already have `findByOrg`), so **no new repo method** is needed. Confirmed.
- **Mock arm** (`MockPaymentProvider`, deterministic, offline — the only arm any suite exercises):
  - `previewProration`/`changePlan` → `prorationCents = signed diff of prorated monthly price` computed from
    domain `priceCents(...)` and a deterministic "remaining fraction" derived from the injected `Clock` +
    `currentPeriodEnd` (no `Date.now`). Records the proration as an `Invoice` row (status OPEN) via the
    existing `ApplyPaymentEvent` seam so it shows in the Invoices panel.
  - `refund` → records a deterministic refund: a credit `Invoice` row (negative `amountCents`, status
    `VOID`) at the prorated-unused amount; returns it.
- **Selection unchanged:** `paymentsFromEnv` (`PAYMENTS_MODE=offline`/no `STRIPE_SECRET_KEY` → mock). All
  suites stay offline.

### Use-case wiring
- `ChangeSubscription`: after the row remap, **if** `providerSubscriptionId` exists, call `payment.changePlan`,
  attach `prorationCents` to the returned `SubscriptionView`, audit `subscription.plan_prorated` with the
  amount. If no provider sub (still FREE / never checked out) → today's pure-row path, `prorationCents: 0`.
- New `PreviewPlanChange` use case → `GET`/`POST` a proration estimate so the UI can show "you'll be
  charged/credited $X" **before** the user confirms.
- `CancelSubscription`: gains `refund?: boolean` (OWNER/ADMIN choice). When true **and** a paid invoice
  exists, call `payment.refund` before flipping to CANCELED; attach `refundedCents` to the view; audit
  `subscription.refunded`. Default `refund:false` → today's behavior, unchanged.
- `INVOICE_WEBHOOK_EFFECTS`: add `charge.refunded` (and/or `credit_note.created`) → invoice state, so a
  real Stripe refund reflects in the Invoices panel on webhook redelivery. Refund is idempotent by
  provider-invoice/charge id.

### Web
`BillingScreen`: a **proration preview** line on the plan selector ("Changing to GROWTH: +$X now / −$Y
credit") driven by `previewProration`; a **refund** confirmation on Cancel ("Refund the unused $Z?" checkbox)
wired to `cancel({ refund })`. `BillingClient` gains `previewProration` + `changePlan`(proration-aware) +
`cancel({refund})`.

### Two micro-decisions for the owner (recommended defaults in **bold**)
- **B-1 · Proration timing:** **`create_prorations` (rides to the next invoice)** vs `always_invoice`
  (charge immediately). Rides-to-next is the Stripe default and least surprising; immediate invoicing adds a
  charge mid-cycle. Recommend rides-to-next; the preview still shows the amount.
- **B-2 · Refund on cancel:** **prorated refund of the unused portion of the current period, opt-in via a
  checkbox** vs full-last-invoice refund vs no-refund/cancel-at-period-end. Prorated-unused is the fair,
  common SaaS posture and matches "reembolsos" without over-refunding. Represented as a credit `Invoice`
  row (negative `amountCents`) in the mock.

### Acceptance criteria (AC-PRORATE-01..07)
1. Plan **upgrade** with an active provider subscription → `changePlan` called, `prorationCents > 0`
   (charge), view carries it, `subscription.plan_prorated` audited.
2. Plan **downgrade** → `prorationCents < 0` (credit).
3. Plan change with **no** provider subscription (FREE) → no Stripe call, `prorationCents: 0`, row path
   unchanged (regression-safe).
4. `previewProration` returns the **same** signed amount `changePlan` would apply, **without** mutating any
   row (read-only).
5. **Cancel with `refund:true`** and a paid invoice → `payment.refund` called, `refundedCents` = prorated
   unused, a credit invoice recorded, `subscription.refunded` audited, status → CANCELED.
6. **Cancel with `refund:false`** (default) → no refund, today's behavior byte-for-byte.
7. **No-leak:** the Stripe secret never appears in any view, invoice row, audit metadata, or error (the S13
   AC-PAY-08 assertion, extended to the new methods).

### Test plan
- **Application unit** (`payments.test.ts` extension, in-memory context): deterministic proration signs +
  amounts, refund amount, `previewProration` == `changePlan` amount + no-mutation, no-provider-sub path.
- **Stripe adapter unit** (`stripe-payments.test.ts` extension, fake injected `Stripe`): asserts
  `subscriptions.update` / `invoices.retrieveUpcoming` / `refunds.create` are called with the expected
  params; no network.
- **API e2e** (`billing.e2e.test.ts` extension, mock arm): preview + change + cancel-with-refund end-to-end,
  cross-tenant 404, non-admin 403.
- **BDD** `specs/slices/40-stripe-proration/proration.feature` (AC-PRORATE-01..07), reusing
  `billing.steps.ts`.
- **Web** `BillingScreen.test.tsx` (preview line + refund checkbox) + `billing.spec.ts` e2e.

---

## Integration plan (orchestrator)
1. Dispatch A + B as two worktree subagents (each: SDD→BDD→TDD, Docker-free verify, adversarial self-review).
2. Serialized stack gates, one at a time, on a quiet machine (the v7 lesson: don't run `test:int` while
   Docker-free subagents build). No migration this round → no `db:deploy` / `prisma generate` step.
3. Sequential FF merges A→B (disjoint; rebase each onto `main` first to absorb the serial docs commit).
4. Update `CLAUDE.md` (new Programa v8 section) + `feature-status.md` + `audit-followup.md` (Bloque-3 #4
   → done) + the auto-memory status file. **Not pushed to origin until the owner says so** (the standing
   `bbc09a1`-is-pushed / follow-ups-not-deployed posture).

## Out of scope (unchanged deferrals)
Rate-limit fail-open hardening (Bloque-3 #3, not picked) · pagination (Bloque-3 #5, not picked) · Stripe
customer-portal already shipped (S34) · voice · Orchestration/Session (TOM-blocked) · provenance/re-embed
(keystone+migration) · billing period scheduler (ACA Job infra).
