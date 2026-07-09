# Slice 36 — DB pool `connection_limit` engine-level proof (SDD Spec)

> Spec-Driven-Design spec for a keystone-free **test-only** hardening slice. No product vocabulary
> (`grep -ri "connection_limit\|pool" specs/_keystone/` returns nothing), no source change, no
> migration, no new dependency. Scope: `apps/api/test/integration/db-pool.int.test.ts` + this spec.
> v0.1 — 2026-07-09. Status: BUILD SLICE. Branch `slice-36-db-pool-proof`.

---

## 0. Why

Slice 31 gave `PrismaService` a bounded connection pool: `withPoolDefaults` appends
`connection_limit` / `pool_timeout` / `connect_timeout` to `DATABASE_URL` (absent-only), passed via
Prisma 6's `datasourceUrl`. Its int test (`db-pool.int.test.ts`) proved the augmented DSN still
*connects* and does a `SELECT 1` round-trip — but a known gap (programa v6 deferred: *"db-pool int
test doesn't independently prove params reach the engine"*) was that **nothing demonstrated
`connection_limit` actually BOUNDS backends at Postgres**. `pool-config.test.ts` only pins the
string-building; a mutation that dropped `connection_limit` from the DSN, or a Prisma version that
ignored it, would slip through both suites. This slice closes that gap with an empirical, engine-level
proof.

## 1. The invariant proven

> A PrismaClient whose DSN carries `connection_limit=N` — produced by the **production**
> `withPoolDefaults` — **never holds more than N concurrent backends at the Postgres engine**, even
> when driven with strictly more concurrent queries than N.

This is engine-level, not string-level: the assertion reads real `pg_stat_activity` rows, so it fails
if the param is built correctly but not honored by the engine (the exact case the string test cannot
catch).

## 2. How the test demonstrates it (mechanism)

`apps/api/test/integration/db-pool.int.test.ts` — new `describe` block
*"DB pool connection_limit is enforced at the Postgres engine (slice 36)"*:

- **`limited`** — a `new PrismaClient({ datasourceUrl })` whose DSN is built by `boundedDsn(base, 2)`,
  which strips any ambient `connection_limit` / `pool_timeout` and then calls the real
  `withPoolDefaults` with `connectionLimit: 2`. So the DSN under test is byte-for-byte what
  `PrismaService` hands Prisma in production — the proof runs through the production code path, not a
  hand-rolled URL.
- **Load** — `CONCURRENCY = 6` (`> LIMIT = 2`) concurrent `SELECT pg_sleep(0.6)` queries fired at once
  through `limited`. Only `LIMIT` can hold a real backend at a time; the other four wait in Prisma's
  client-side pool and **never reach Postgres**.
- **`observer`** — an INDEPENDENT `PrismaClient` (unbounded pool, so its polling is never starved)
  that polls `pg_stat_activity` every 40 ms and records the **peak** count of concurrently-active
  sleep backends:

  ```sql
  SELECT count(*)::int AS n
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND state = 'active'
    AND pid <> pg_backend_pid()
    AND query LIKE '%pg_sleep%'
    AND query NOT LIKE '%pg_stat_activity%'
  ```

  - Keys off the **intrinsic** function name `pg_sleep` — un-strippable, survives comment
    normalization / parameterization (`pg_sleep($1)` still contains it). A cosmetic `/* slice-36 pool
    probe */` tag is on the sleep query for readability only; it is **deliberately not** in the WHERE,
    so its survival is irrelevant to correctness.
  - `NOT LIKE '%pg_stat_activity%'` excludes every observer poll (its own query text references that
    view); `pid <> pg_backend_pid()` is insurance for the same.
  - `datname = current_database()` scopes to this DB; `count(*)::int` (not bare `count(*)`) avoids a
    BigInt so `n > peak` compares numerically.

- **Assertions** — `peak >= 1` (non-vacuous floor: we genuinely observed active backends, so the test
  can't pass by simply missing the window) **and** `peak <= LIMIT` (**the invariant**). `<=` rather
  than `=== LIMIT` tolerates Prisma ramping its pool lazily or holding an internal connection, per the
  task's non-flakiness guidance. Were `connection_limit` ignored, `peak` would climb toward
  `CONCURRENCY` and the `<= LIMIT` assertion would fail.

## 3. Why it is safe on the SHARED int Postgres (tier-0)

Read-only: it issues `pg_sleep` and reads `pg_stat_activity` — **no `TRUNCATE`, no writes, no table it
doesn't own**. Both clients `$disconnect()` in `afterAll`, so no backend lingers for the next suite.
`describe.skipIf(!process.env.DATABASE_URL)` skips cleanly without a DB (the int config populates
`DATABASE_URL` before collection, so it does **not** skip under the orchestrator — it must run). The
`pg_sleep` signal is unambiguous because int execution is serial (`fileParallelism: false`) and
nothing else in the app issues `pg_sleep`.

## 4. Determinism / margin

- `SLEEP_S = 0.6` over `LIMIT = 2` → three serial batches ≈ 1.8 s total window; `POLL_MS = 40` gives
  ~15 samples per batch, so a peak of 2 is caught deterministically. Total window (~1.8 s) is well
  under `pool_timeout = 10 s`, so the queued (5th/6th) queries never pool-timeout.
- Filter keys on intrinsic query text + `current_database()` — independent of the ambient
  `DATABASE_URL` the suite inherits (`boundedDsn` strips ambient pool params first).

## 5. Deliverables

- `specs/slices/36-db-pool-proof/README.md` — this spec.
- `apps/api/test/integration/db-pool.int.test.ts` — the new engine-level `describe` block (the
  existing slice-31 boot / round-trip / no-clobber tests are kept — they are complementary).

## 6. Out of scope / deferred

- `pool_timeout` / `connect_timeout` engine-effect proofs — deterministically forcing a pool-timeout
  or connect-timeout risks flakiness against a healthy shared DB; `connection_limit` was the priority.
- No BDD `.feature` — this is an infra/test hardening seam driven SDD → int test, mirroring slices 27
  / 31.

## 7. Verification in this stream

Tier-0 rule: the shared int Postgres is used by concurrent worktrees, so `test:int` was **NOT** run
here. Verified only `pnpm -r typecheck` + `pnpm lint`. The orchestrator runs the proof serially via
`pnpm --filter @gilgamesh/api test:int`.
