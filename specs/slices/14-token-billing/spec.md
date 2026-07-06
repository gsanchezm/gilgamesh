# Slice 14 — Brain token billing (SDD Spec)

> Spec-Driven-Design spec for the fourteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`, **v0.6** — this slice
> depends on the v0.6 token-billing amendment: `Subscription.brainTokensQuota`/`brainTokensUsed` §2,
> the §9 AI Brain token allowances, and the §2 `BrainUsage` billing-hookup note) → **Decisions log**
> (`docs/research/decisions-log.md`) → the slice-9 Brain spec (`specs/slices/09-brain/spec.md`) and
> the slice-10 4-tier spec (`specs/slices/10-billing-4tier/spec.md`) for the two systems joined here.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-07-06. Status: BUILDING (SDD → BDD → TDD on branch `slice-14-token-billing`).

---

## 0. Owner decisions S14 (FROZEN)

1. **Billable tokens = `inputTokens + outputTokens`.** Cache read/create tokens are EXCLUDED —
   prompt caching must never penalize the customer.
2. **ALL org-attributed surfaces count**: `CHAT`, `ROUTER`, `GENERATE`, `EMBED`. The GLOBAL corpus
   ingest stays unmetered (it already is — `BrainUsage.orgId` is non-null; platform ingest has no
   tenant to attribute, spec 16 AC-EMB-06).
3. **Allowances derive from `PLAN_CATALOG`** (keystone §9): FREE 100,000/mo · STARTER 2,000,000/mo ·
   GROWTH 10,000,000/mo · SCALE unlimited. Single source, no duplicated numbers — the slice-10
   derivation pattern (`packages/domain/src/billing/plans.ts` derives from
   `packages/domain/src/pricing/plan-catalog.ts`).
4. **Quota exhausted → `QUOTA_EXCEEDED`** (mapped to HTTP **402** since slice 4). **EXCEPT on chat
   surfaces**: a chat send NEVER 500s or 402s — the block is narrated in-chat, mirroring the
   slice-9 brain-outage narration in `SendChatMessage` (AC-BRAIN-03 semantics).
5. **Enforcement**: check the quota BEFORE the brain call; charge the ACTUAL usage after,
   atomically (`UnitOfWork`), in the same transaction that records the `BrainUsage` row. Reference
   pattern: the slice-4 `TriggerRun` run-minutes enforcement.
6. **Reset on billing-period rollover = exactly the executions behavior** (investigated, §4 below).
7. **New orgs / onboarding seeds get the FREE allowance; existing orgs are backfilled per their
   current plan in the migration.**

---

## 1. Feature intent

Close the slice-9/slice-10 deferral ("Brain token charging hookup"): the per-call `BrainUsage`
metering that has existed since slice 9 becomes **billing** — every org has a per-plan monthly AI
token allowance stored on its `Subscription` (`brainTokensQuota` / `brainTokensUsed`, keystone §2
v0.6), every org-attributed brain call charges its billable tokens against it atomically, and an
exhausted allowance blocks further AI work (402 on API surfaces, narrated in-chat) until the plan
is upgraded. SCALE is unlimited and never blocks.

---

## 2. Scope

### In scope

- **domain** — `PlanTierLimits` gains the structured `aiTokensPerMonth: PlanTierLimit` (100k / 2M /
  10M / `'unlimited'`); `planLimits(plan)` derives `brainTokensQuota` (with the 1,000,000,000
  storage cap for `'unlimited'`) + a `brainTokensUnlimited` flag. No duplicated numbers.
- **application** —
  - `SubscriptionRecord` gains the keystone §2 fields `brainTokensQuota`/`brainTokensUsed`;
    `SubscriptionRepository` gains `chargeBrainTokens(orgId, tokens)` (atomic unconditional
    increment — see §5.2 for why it is unconditional where `chargeRunMinutes` is conditional).
  - A shared charging seam **`BrainBilling`** (slice-level name, §9): `isExhausted(orgId)` /
    `assertWithinQuota(orgId)` (throws `QUOTA_EXCEEDED`) / `charge(orgId, surface, tier, usage)` —
    the charge appends the `BrainUsage` row AND increments `Subscription.brainTokensUsed` by the
    billable tokens **in one `UnitOfWork` transaction** (`brainUsage` joins the UoW `Repositories`
    bundle).
  - **`SendChatMessage`** (CHAT + ROUTER): one pre-check per send, before ANY brain call; when
    exhausted, the send skips the router/retrieval/answer brain calls entirely and narrates the
    block (the USER message still persists first — spec 08 §10.3). All real calls charge actuals.
  - **`GenerateDrafts`** (GENERATE + its grounding EMBED): pre-check → `QUOTA_EXCEEDED` (402);
    charge actuals after.
  - **Embed-metered paths** (EMBED): `SearchKnowledge`, `UploadKnowledgeDocument`, org-attributed
    `IngestKnowledge` pre-check when org-attributed → `QUOTA_EXCEEDED` (402); the shared
    `meterEmbed` now charges through `BrainBilling` (still swallowed on failure — a metering/charge
    hiccup must never break retrieval, the S16 AC-EMB-05 rule). Grounding retrieval inside
    chat/generate is guarded by the calling use case's own pre-check.
  - `SubscriptionView` gains `brainTokensQuota` / `brainTokensUsed` / `brainTokensUnlimited`;
    `ChangeSubscription` remaps `brainTokensQuota` from the new plan's limits exactly like
    `runMinutesQuota` (usage preserved); onboarding seeds the FREE allowance (derived, not
    hard-coded).
- **api** — Prisma `Subscription` gains `brain_tokens_quota`/`brain_tokens_used` + migration with
  per-plan backfill; `chargeBrainTokens` raw-SQL adapter; `brainUsage` joins `makePrismaRepos`;
  BOTH persistence wirings bind `BrainBilling`; the chat/testlab/knowledge modules inject it.
  No new routes; no DTO changes beyond the extended `SubscriptionView`.
- **web** — the Billing screen's AI-usage card gains a quota meter: `used / quota` with percentage
  (or the unlimited state) from the subscription view.
- **BDD** — `token-billing.feature` (AC-TOKB-xx) against API+Postgres, extending the slice-4/9/10
  steps.

### Out of scope (explicitly deferred)

- The **billing-period rollover job** that resets the monthly counters — deferred as one shared
  mechanism for BOTH `runMinutesUsed` and `brainTokensUsed` (§4).
- Per-token **pricing/overage charges** (Stripe metered billing) — tokens only gate, never bill
  money in this slice.
- Marketing-copy updates on the public Pricing page (`PlanTier.features` strings) — the structured
  limit lands now; the copy line is a content follow-up.
- Spending caps/alerts, usage-view period selector (open questions from spec 09).

---

## 3. Acceptance criteria

- **AC-TOKB-01** — Allowances derive per tier: a new org's subscription carries the FREE allowance
  (`brainTokensQuota` 100,000, `brainTokensUsed` 0); changing the plan remaps `brainTokensQuota`
  per the catalog (STARTER → 2,000,000; GROWTH → 10,000,000) and **preserves** `brainTokensUsed`
  (the executions-consistent no-reset rule, §4). Derivation from `PLAN_CATALOG` is unit-pinned
  (single source — the slice-10 pattern).
- **AC-TOKB-02** — A chat send charges the org: its CHAT (and ROUTER, when routed) `BrainUsage`
  rows land together with a `brainTokensUsed` increment equal to the billable sum
  (`inputTokens + outputTokens`; cache tokens excluded) — reconciled row-sum vs counter.
- **AC-TOKB-03** — A generate call charges its GENERATE row (and its grounding EMBED row) the same
  way; the counter always equals the org's billable row sum.
- **AC-TOKB-04** — Quota exhausted blocks API surfaces: `POST /projects/{id}/test-cases/generate`,
  `GET /knowledge/search` (org-attributed) and `POST /orgs/{orgId}/knowledge/documents` respond
  **402** with a `Problem` document, and no brain call is made (no new `BrainUsage` rows).
- **AC-TOKB-05** — Quota exhausted NEVER breaks chat: the send returns 201, the USER message
  persists, the answer narrates the token-allowance block (no 402/500), no brain call is made and
  nothing is charged.
- **AC-TOKB-06** — SCALE is unlimited: with `brainTokensUsed` ≥ the stored quota cap, chat answers
  normally (no narration) and generate succeeds; usage keeps being metered and charged (the
  counter keeps counting — only blocking is bypassed).
- **AC-TOKB-07** — Rollover consistency (§4): no operation except a future shared rollover resets
  `brainTokensUsed` — plan changes, checkouts and webhooks preserve it, exactly like
  `runMinutesUsed` today.

---

## 4. Rollover investigation (owner decision S14-6, evidence)

How `runMinutesUsed` "resets" today — verified in code on `main`:

| Path | Effect on `runMinutesUsed` |
|------|---------------------------|
| `CompleteOnboarding` | seeds `0` (with the FREE quota). |
| `TriggerRun` → `chargeRunMinutes` | atomic conditional increment; the ONLY writer. |
| `ChangeSubscription` | remaps `runMinutesQuota` from the new plan; **used preserved**. |
| `ConfirmCheckout` | extends `currentPeriodEnd`; **used untouched**. |
| `ApplyPaymentEvent` (invoice webhooks / checkout completed) | invoice + subscription `status` only; **used untouched**. |

**There is NO automatic billing-period reset for executions anywhere.** Token reset is therefore
implemented as *exactly the same lifecycle*: seeded 0 → atomically incremented → quota remapped on
plan change with usage preserved → reset by nothing. When the shared rollover mechanism lands
(keystone §9: "Resets each billing period (same rollover as executions)"), it MUST reset
`runMinutesUsed` and `brainTokensUsed` together, in one place. Building a token-only reset here
would have made the two counters inconsistent — the opposite of the owner decision.

---

## 5. Design notes

### 5.1 Enforcement points (check BEFORE, charge AFTER)

| Surface | Use case | Pre-check | Exhausted behavior | Charge |
|---------|----------|-----------|--------------------|--------|
| ROUTER + CHAT (+ grounding EMBED) | `SendChatMessage` | once per send, after the USER message persists, before any brain call | narrated AGENT answer; no brain calls; nothing charged | per real call, actual usage |
| GENERATE (+ grounding EMBED) | `GenerateDrafts` | before retrieval/complete | `QUOTA_EXCEEDED` → 402 | per real call, actual usage |
| EMBED (search) | `SearchKnowledge` (org-attributed) | before the query embed | `QUOTA_EXCEEDED` → 402 | actual provider token count |
| EMBED (upload) | `UploadKnowledgeDocument` / org-attributed `IngestKnowledge` | before the document embed | `QUOTA_EXCEEDED` → 402 | actual provider token count |
| (global corpus ingest) | `IngestKnowledge` without attribution | none | never blocked | unmetered (unchanged) |

The pre-check is `brainTokensUsed >= brainTokensQuota` on a metered plan (`brainTokensUnlimited`
false). No subscription row → no metering, never blocked (the `chargeRunMinutes` precedent).

### 5.2 Why the post-call charge is unconditional (delta vs `chargeRunMinutes`)

`TriggerRun` knows its cost UP FRONT (scenario count), so the in-transaction conditional increment
can refuse and roll the whole run back. A brain call's cost is known only AFTER the tokens are
already consumed — refusing the charge would un-record real usage and hand out free calls. So
`chargeBrainTokens` increments unconditionally; the authoritative gate is the NEXT call's
pre-check. Overshoot is bounded by one call (one send, in chat) past the quota, is recorded
truthfully, and blocks everything after it. Mid-send crossings (router within quota, answer pushes
past it) finish the send — a send is atomic from the member's perspective.

### 5.3 Atomicity

`BrainBilling.charge` runs `brainUsage.append(row)` + `subscriptions.chargeBrainTokens(orgId,
billable)` inside ONE `UnitOfWork.transaction` — the usage row and the counter can never diverge
(the §2 keystone note: "charge Subscription.brainTokensUsed atomically per call"). `brainUsage`
joins the UoW `Repositories` bundle in both wirings to make that possible.

### 5.4 Failure semantics (unchanged per surface)

- CHAT/ROUTER/GENERATE: a charge failure propagates (exactly like the pre-existing metering
  append — S9 never swallowed it there).
- EMBED via `meterEmbed`: swallowed (S16 AC-EMB-05: metering must never fail search/grounding);
  worst case one uncharged embed, never a broken user call.

### 5.5 Storage

`brain_tokens_quota int NOT NULL` / `brain_tokens_used int NOT NULL` on `subscriptions` (int4 —
the 1e9 unlimited cap fits; `brainTokensUnlimited` from the plan is the real signal, the slice-10
cap pattern). Migration backfills `brain_tokens_quota` per each org's current plan and
`brain_tokens_used = 0`.

---

## 6. API operations touched (keystone §6 — no new routes)

| Method + path | Change |
|---------------|--------|
| `GET/PATCH /orgs/{orgId}/subscription` (+`/seats`, checkout, cancel) | `SubscriptionView` gains `brainTokensQuota`/`brainTokensUsed`/`brainTokensUnlimited`; plan change remaps the token quota. |
| `POST /projects/{id}/test-cases/generate` | 402 `Problem` when the allowance is exhausted. |
| `GET /knowledge/search` | 402 when exhausted (org-attributed callers). |
| `POST /orgs/{orgId}/knowledge/documents` | 402 when exhausted. |
| `POST /chat/{sessionId}/messages` | never 402/500 — narrated block. |
| `GET /orgs/{orgId}/brain/usage` | unchanged (rows keep landing; SCALE included). |

---

## 7. Screen behavior

**Billing (`/billing`)** — the AI-usage card gains a quota meter: `brainTokensUsed` /
`brainTokensQuota` with a percentage bar on metered plans, an explicit "Unlimited" state on SCALE
(mirrors the executions meter directly above it).

---

## 8. Traceability matrix

| AC | Where verified |
|----|----------------|
| AC-TOKB-01 | `token-billing.feature` (seed + remap + preserve) · domain unit derivation pins |
| AC-TOKB-02 | `token-billing.feature` (chat charge reconciliation) · application unit |
| AC-TOKB-03 | `token-billing.feature` (generate charge reconciliation) · application unit |
| AC-TOKB-04 | `token-billing.feature` (402 on generate/search/upload) · application unit |
| AC-TOKB-05 | `token-billing.feature` (narrated chat block) · application unit |
| AC-TOKB-06 | `token-billing.feature` (SCALE never blocks) · application unit |
| AC-TOKB-07 | `token-billing.feature` (plan change preserves used) · §4 evidence + application unit |

---

## 9. Deviations & open questions

**Deviations (slice-level names; keystone untouched):**
- **`BrainBilling`** (+ its `BrainTokenMeter` interface) — the shared check/charge seam, and
  `billableTokens()` — the single definition of billable tokens. The `SelectingBrain`/
  `MeteredBrain`/`ChatToolRegistry` naming precedent (spec 09 §13).
- **`chargeBrainTokens` is unconditional** where `chargeRunMinutes` is conditional — §5.2.
- **`brainTokensUnlimited`** derived flag on `PlanLimits`/`SubscriptionView` (the slice-10
  `unlimited` precedent for executions).
- The `EmbedMeter` bag (`{brainUsage, ids, clock}`) is replaced by the `BrainTokenMeter` seam —
  EMBED metering now always charges; its swallow-on-failure behavior is preserved.

**Open questions (non-blocking):**
- The shared rollover mechanism (cron vs webhook `invoice.paid` period detection) — owner decision
  when periods become real (Stripe subscription lifecycle).
- Whether SCALE's counter should surface anywhere as "fair use" telemetry — product call.
