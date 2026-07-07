# Slice 21 — Billing-period usage rollover (closes S14-6) (SDD Spec)

> Spec-Driven-Design spec for the twenty-first vertical slice of Gilgamesh.
> Authority order: **Keystone v0.6** (`specs/_keystone/foundation-vocabulary.md`: §2
> `Subscription.runMinutesUsed` / `brainTokensUsed`) → **Decisions log** → this spec.
> All entity/field names below are used **verbatim** from the keystone. **No keystone change** —
> this resets two existing counters; no new vocabulary, entity, enum, port method on the wire, or
> HTTP route.
> v0.1 — 2026-07-07. Status: BUILT on branch `feat-billing-rollover` (typecheck · lint · Docker-free
> suites green; the serialized int/BDD gates run before merge).

---

## 0. Owner decisions S21 / background

Two `Subscription` usage counters accumulate over a billing period and are NEVER auto-reset today:

- `runMinutesUsed` — execution minutes charged (slice 3/4, atomic `chargeRunMinutes`).
- `brainTokensUsed` — billable AI tokens charged (slice 14, atomic `chargeBrainTokens`).

Slice 14 (owner note **S14-6**) deferred the period rollover with an explicit mandate: *"the future
rollover job must reset BOTH counters together."* This slice delivers exactly that and nothing more.

- **S21-A — dedicated atomic op, NOT `save()`.** The S14 review made `SubscriptionRepository.save()`
  deliberately OMIT the usage counters so a stale admin read→save can never clobber a concurrent
  atomic charge (lost-charge race). The reset therefore lives in its own repository method
  `resetUsage(orgId?)` that issues one atomic `UPDATE … SET run_minutes_used = 0, brain_tokens_used
  = 0 [WHERE org_id = …]` — mirroring the raw-SQL style of `chargeRunMinutes`/`chargeBrainTokens`. It
  writes a **constant** (0) and reads nothing beforehand, so unlike `save()` it structurally cannot
  clobber a charge based on a stale snapshot.
- **S21-B — both counters in ONE statement (the S14-6 invariant).** A reset that zeroed only one
  counter would leave the org half-metered against the new period. The single UPDATE guarantees the
  two counters always move to 0 together — a reader can never observe a torn (one-zeroed) state.
- **S21-C — operator-triggered, no HTTP route (owner scope).** Like `ingest:corpus`, the rollover is
  run by an operator/cron script (`pnpm --filter @gilgamesh/api rollover:billing`), not exposed as an
  authenticated API surface. No route, no controller, no keystone change.
- **S21-D — counters only.** The rollover zeroes the two period counters ONLY. It does **not** touch
  `plan`/`seats`/`status`/`runMinutesQuota`/`brainTokensQuota`/`billingCycle`/`provider*`/
  `currentPeriodEnd`, and it does **not** delete or mutate the immutable `BrainUsage` / `Invoice`
  ledger rows (those are the historical usage/billing record; the counters are just the
  current-period quota tally). Advancing `currentPeriodEnd` / period-window management is a named
  follow-up (see §6).

## 1. Feature intent

A safe, idempotent, atomic operation that resets an org's (or every org's) two billing-period usage
counters to zero at a period boundary — so the next period's quota gates (`chargeRunMinutes`'
conditional guard and `BrainBilling`'s pre-check) start from a clean tally. Both counters reset
together in a single statement; nothing else changes.

## 2. Scope

### In scope
- **application** — `SubscriptionRepository.resetUsage(orgId?)` port method (returns the number of
  subscription rows reset) + its in-memory adapter; `ResetBillingUsage` use case
  (`{ orgId? } → { reset }`) that calls the port directly (a single atomic write needs no UnitOfWork
  wrapper — the same shape as the direct `chargeRunMinutes`/`chargeBrainTokens` atomic methods).
- **api** — `PrismaSubscriptionRepository.resetUsage` (raw-SQL atomic UPDATE, per-org and all-orgs
  branches, byte-identical SQL to the operator script); a `scripts/rollover-billing.mjs` operator
  script modeled on `scripts/ingest-corpus.mjs` (reads `DATABASE_URL`, news up Prisma, resets; an
  optional `--org <id>` arg, default = all orgs) + a `rollover:billing` package script.
- **BDD** — `billing-rollover.feature` (AC-ROLL-xx) against API+Postgres, driving the use case over
  the Prisma-backed repository (no HTTP surface exists — the steps invoke the use case directly).
- **int** — `billing-rollover.int.test.ts` exercising the real atomic reset (per-org, all-orgs,
  idempotent, other-fields-untouched, and the two serial charge/reset orderings) against Postgres.

### Out of scope (explicitly deferred)
- Advancing `currentPeriodEnd` / a period-window model / a scheduled cron trigger (owner runs the
  script; a scheduler is infra). The rollover is the reset; wiring *when* it runs is separate.
- Any HTTP/admin UI surface for triggering a reset.
- Emitting an audit-log or `BrainUsage` marker row for the rollover (it is a system maintenance job,
  like `ingest:corpus`; the immutable ledgers already record what was charged before the reset).
- Prorated / partial resets, or resetting one counter without the other (forbidden by S14-6).

## 3. Contract

- Reads/writes only the existing keystone §2 `Subscription.runMinutesUsed` and
  `Subscription.brainTokensUsed` (both already `Int`, non-null). **No schema migration** — the
  columns exist since slice 1 (run minutes) and slice 14 (brain tokens).
- New application-port method (internal seam, not on the wire): `resetUsage(orgId?: string):
  Promise<number>` on `SubscriptionRepository`. Omitting `orgId` targets every subscription.

## 4. Acceptance criteria

- **AC-ROLL-01** — Resetting an org with non-zero counters zeroes **both** `runMinutesUsed` **and**
  `brainTokensUsed` in one atomic operation (never one without the other — S14-6).
- **AC-ROLL-02** — A reset does **not** change any other subscription field: `plan`, `seats`,
  `status`, `runMinutesQuota`, `brainTokensQuota`, `billingCycle`, `provider*`, `currentPeriodEnd`
  are all untouched.
- **AC-ROLL-03** — Resetting **all** (no `orgId`) zeroes every org's counters in a single statement;
  the returned count equals the number of subscription rows.
- **AC-ROLL-04** — The reset is **idempotent**: resetting an org already at zero leaves it at zero
  (and still reports the matched row — parity with Postgres, which counts a no-change UPDATE as
  affected).
- **AC-ROLL-05** — Resetting an org that has **no** subscription row is a harmless no-op (zero rows
  affected; no error).
- **AC-ROLL-06** — Concurrency posture (documented, deterministic): the reset is a single UPDATE, so
  a concurrent charge serializes at the row level — it lands **fully before** the reset (its tokens
  are zeroed with the period) or **fully after** (its tokens count against the new period). There is
  no torn write and no half-reset. A boundary-straddling charge landing in the new period is the
  inherent, accepted period-boundary race — identical to any billing cutoff.

## 5. Non-functional / money-safety

- **Atomicity** — one SQL statement sets both counters; Postgres row-locking serializes it against
  `chargeRunMinutes`/`chargeBrainTokens`. No read-modify-write on the app side ⇒ no TOCTOU, no lost
  update. This is *stronger* than `save()`, which was banned from the counters precisely because it
  writes back a previously-read (stale) value; `resetUsage` writes the constant 0 and reads nothing.
- **Both-or-neither** — the single statement is the S14-6 guarantee: the two counters can never
  diverge across a reset.
- **SQL parity** — `PrismaSubscriptionRepository.resetUsage` and the inlined `rollover-billing.mjs`
  SQL are byte-identical (the `ingest-corpus.mjs` duplication precedent — the script can't import the
  compiled TS adapter). Any divergence would be a money bug; kept in lockstep.
- **Env** — the script reads `DATABASE_URL` (via `PrismaClient`), exactly like `ingest:corpus`.

## 6. Follow-ups (named)

- A scheduler (cron / Azure job) that invokes `rollover:billing` at each period boundary, and a
  `currentPeriodEnd` advance so the boundary is data-driven rather than operator-timed.
- If per-org billing periods diverge, a `WHERE current_period_end <= now()` variant so a global run
  only rolls the orgs that are actually due.
