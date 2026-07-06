# Slice 10 — Billing 4-tier migration (SDD Spec)

> Spec-Driven-Design spec for the tenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`, §9 pricing) for all
> names/enums/ports/paths → **Decisions log** (`docs/research/decisions-log.md`, "NEW pricing /
> business model", 2026-07-01) → the marketing catalog (`packages/domain/src/pricing/plan-catalog.ts`).
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-07-06. Status: DONE — formalizes + hardens the 4-tier migration (the semantics landed
> with the capture-12 billing re-skin, commit `7632020`); this slice adds the SDD/BDD contract and
> makes `PLAN_CATALOG` the **single source** the billing domain derives from.

---

## 0. Owner decision S10

**Pure semantic migration onto `PLAN_CATALOG`** — the owner's 2026-07-01 business model (four
self-serve tiers billed per active workspace/month) **supersedes the slice-4 pricing**. No keystone
change: keystone §9 already states the 4-tier pricing and the `Plan` enum is already
`FREE | STARTER | GROWTH | SCALE`.

**Field mapping (documented, NO schema/keystone rename):**

| Keystone `Subscription` field | 4-tier meaning |
|---|---|
| `seats` | **active workspaces** |
| `runMinutesQuota` | **monthly executions quota** |
| `runMinutesUsed` | **monthly executions used** |

`MockPaymentProvider` is **unchanged** (still the deterministic offline stub behind the frozen
`PaymentProvider` port; real Stripe stays deferred).

---

## 1. Feature intent

One canonical pricing model. `packages/domain/src/pricing/plan-catalog.ts` (`PLAN_CATALOG`) is the
single source of truth for tier prices **and structured limits**; the billing domain
(`packages/domain/src/billing/plans.ts` — `planLimits` / `priceCents`) **derives** from it, so the
marketing pricing page, the billing API and the `/billing` screen can never disagree:

- **FREE** $0 — 1 workspace · 2 services/workspace · 500 executions/mo · 1 user.
- **STARTER** $29/mo — unlimited workspaces · 5 services · 5,000 executions · 3 users.
- **GROWTH** $99/mo — 15 services · 25,000 executions · unlimited users.
- **SCALE** $499/mo base incl. **10 workspaces + $99/extra workspace** · unlimited executions/services.
- **Annual = 10 charged months** (2 months free); the computed price is the per-month equivalent, rounded.

---

## 2. Scope

### In scope
- **domain** — `PlanTier` gains structured `limits` (workspaces / servicesPerWorkspace /
  executionsPerMonth / usersPerWorkspace / includedWorkspaces, `'unlimited'` where uncapped);
  `planLimits(plan)` + `priceCents(plan, cycle, activeWorkspaces)` derive from `PLAN_CATALOG`
  (no duplicated numbers; `'unlimited'` maps to the storage caps 1,000,000 / 1,000,000,000 with the
  `unlimited` flag as the real signal; SCALE pricing is workspace-count-aware).
- **application** — `ChangeSubscription` / `UpdateSeats` / `StartCheckout` / `ConfirmCheckout` keep
  their signatures; the `SubscriptionView` exposes the **computed** monthly `priceCents` + the plan
  limits so the UI never recomputes. Regression pins for the SCALE add-on price and the exact annual price.
- **api** — `BillingModule` unchanged routes (keystone §6); Docker-free e2e asserts the computed
  price the API returns (SCALE base / +extra workspaces / annual).
- **web** — `BillingScreen` renders the 4 tiers and the computed price from the view; the SCALE
  extra-workspace line derives from the catalog (no hard-coded $99/10).
- **BDD** — `billing-4tier.feature` (AC-B4T-xx) against API+Postgres, extending the slice-4 steps.

### Out of scope (explicitly deferred)
- Real Stripe, `Invoice` + `listInvoices`, webhooks (`handleWebhook`) — later billing slice.
- Renaming the `Subscription` storage columns (`seats`, `runMinutes*`) — the mapping above stands.
- Per-workspace metering of services/users (anti-abuse enforcement beyond the workspace cap),
  proration, token charging for Brain usage (flagged in slice 9).
- The public Pricing page (done, slice-7 Ph6) and the capture-12 re-skin (done, `7632020`).

---

## 3. Acceptance criteria

- **AC-B4T-01** — Changing the plan remaps the executions quota (`runMinutesQuota`) **and** the
  per-workspace limits per the catalog (STARTER → 5,000 exec · 5 services; GROWTH → 25,000 · 15),
  and the response carries the computed monthly `priceCents` ($29 / $99).
- **AC-B4T-02** — The FREE workspace cap (1) is enforced on `UpdateSeats` (`VALIDATION` → 422), and a
  plan change whose workspace cap is below the current active workspaces is rejected (`VALIDATION`).
- **AC-B4T-03** — SCALE computed price = $499 base including 10 workspaces + $99 per extra workspace
  (10 ws → 49900¢; 12 ws → 69700¢), asserted on the price **the API returns**; SCALE executions are
  unlimited.
- **AC-B4T-04** — Annual billing charges 10 months: the computed per-month price is
  `round(monthly × 10 / 12)` (GROWTH → 8250¢; STARTER → 2417¢).
- **AC-B4T-05** — (regression) The executions quota still blocks runs on a metered plan
  (`QUOTA_EXCEEDED` → 402); SCALE runs are never quota-blocked.
- **AC-B4T-06** — (regression) RBAC + tenant isolation are unchanged: a `MEMBER` mutating → 403; a
  non-member on the org's subscription endpoints → 404.

---

## 4. Non-functional

- **Single source** — every tier number (price, add-on, limits, annual months) lives once, in
  `PLAN_CATALOG`; `plans.ts` derivation is pure (Clean Architecture, no framework imports).
- **No contract drift** — keystone routes/DTOs unchanged; both persistence wirings untouched.
- **Reproducibility** — the mock provider stays deterministic/offline.
