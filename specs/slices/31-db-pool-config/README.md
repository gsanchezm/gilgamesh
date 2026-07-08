# Slice 31 — DB connection pool config (SDD Spec)

> Spec-Driven-Design spec for a keystone-free infra addition.
> Authority order: this is an **infra / deployment** concern (database connection posture), NOT
> product vocabulary — confirmed by `grep -ri "connection_limit\|pool" specs/_keystone/` returning
> nothing. No keystone change; `apps/api/**` + this spec only; no new npm dependency (WHATWG `URL`).
> v0.1 — 2026-07-08. Status: BUILD SLICE. Branch `feat-db-pool-config`.

---

## 0. Why

Staging runs on **Azure Container Apps** with **Azure Postgres Flexible B1ms** (`specs/infra/
staging-deploy.md`), which has a LOW `max_connections` (~35, minus superuser/maintenance reserved),
and the app **scales to zero** for cost. Two failure modes follow:

1. **Connection exhaustion.** Today `PrismaService` calls `$connect()` with Prisma's *default*
   pool sizing (`num_cpus * 2 + 1`), unbounded relative to the server. A burst — or a brief overlap
   of an old + new ACA revision during a rolling update — can open more connections than B1ms allows.
2. **Slow / racy first connect.** On a scale-to-zero **cold wake** the first TCP + auth handshake
   can race Postgres coming up (and, on boot, `entrypoint.sh` runs `prisma migrate deploy` first,
   which already gates on DB reachability — but the app's own first `$connect()` still has a narrow
   window). A default `connect_timeout` can hang or fail the first request.

Prisma sizes its pool + timeouts from **DATABASE_URL query params** — `connection_limit`,
`pool_timeout`, `connect_timeout` (the latter two in **seconds**) — read from the URL at runtime.
So the clean, dependency-free fix is to **append sane defaults to the connection string when the
operator hasn't set them**, and hand the augmented URL to the client via the runtime `datasourceUrl`
override. Dev/test behavior is unchanged: the helper only ADDS **absent** params, so a localhost
DSN keeps connecting exactly as before.

## 1. Acceptance criteria

- **AC-DBP-01a** — A pure helper `withPoolDefaults(url, opts)` returns the URL with
  `connection_limit`, `pool_timeout`, and `connect_timeout` set to sane defaults **only where each is
  absent**. A value the operator already set in the URL is **never overridden** (absent-only).
- **AC-DBP-01b** — A falsy, **non-postgres**, or **malformed** URL is returned **unchanged** — the
  helper **never throws** (a bad URL must not break boot; Prisma surfaces its own connect error).
- **AC-DBP-01c** — The three defaults are configurable via env — `DB_CONNECTION_LIMIT`,
  `DB_POOL_TIMEOUT_S`, `DB_CONNECT_TIMEOUT_S` — each independently, with the sane fallback when the
  var is unset **or** non-positive/non-integer (a fat-fingered value can't degrade the posture).
- **AC-DBP-01d** — DEFAULT behavior for the existing **dev/test URL**: the helper is applied in **all
  envs**, but because it only ADDS absent params, the localhost DSN
  (`postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public`) keeps connecting — the
  Docker-free / `test:int` / `test:bdd` suites are unaffected. The augmented URL preserves the
  original host / db / user / `sslmode` / `schema` and still parses.
- **AC-DBP-02** — (defense-in-depth, optional per task) a bounded `connectWithRetry` retries a
  transient cold-wake `$connect()` failure (default 2 retries, linear backoff), and on **exhaustion
  rethrows the last error unmodified** — a failed connect still surfaces clearly, never swallowed.

## 2. Design

### 2.1 The pure helper (`apps/api/src/persistence/prisma/pool-config.ts`)

- `PoolDefaults` = `{ connectionLimit, poolTimeoutS, connectTimeoutS }`.
- `DEFAULT_POOL_DEFAULTS` = `{ connectionLimit: 5, poolTimeoutS: 10, connectTimeoutS: 10 }`.
  **Why 5:** conservative for a **single small replica** against B1ms's ~35 `max_connections`. It
  leaves headroom even when an old + new ACA revision briefly overlap during a rolling update, plus
  `prisma migrate`'s own short-lived boot connection. Up to ~10 would still be safe single-replica;
  5 is the deliberately conservative pick. **Why 10s** for both timeouts: absorbs a scale-to-zero
  cold wake without hanging a request forever (Prisma's stock defaults are `pool_timeout=10s`,
  `connect_timeout=5s`; we bump connect to 10s for the cold-wake window).
- `poolDefaultsFromEnv(env)` — resolves each field from `DB_CONNECTION_LIMIT` / `DB_POOL_TIMEOUT_S`
  / `DB_CONNECT_TIMEOUT_S`; non-positive / non-integer → the default.
- `withPoolDefaults(url, opts)` — WHATWG `URL` + `searchParams`: parse (return unchanged on throw),
  reject non-`postgres:`/`postgresql:` protocols (return unchanged), then **`set` each param only if
  `!searchParams.has(name)`**, and `return url.toString()`. Pure, no framework, exhaustively tested.

### 2.2 Applying it (`prisma.service.ts`)

`PrismaService` reads the base URL from **env** (`process.env.DATABASE_URL` — the repo's `*FromEnv`
infra idiom, same as `vaultFromEnv`/`brainFromEnv`), augments it, and passes it via the Prisma 6
runtime **`datasourceUrl`** constructor option:

```ts
constructor() {
  const url = withPoolDefaults(process.env.DATABASE_URL, poolDefaultsFromEnv());
  super(url ? { datasourceUrl: url } : {});
}
```

- **`datasourceUrl` (not `datasources`)** — a single string, the Prisma-native runtime override; it
  coexists with `url = env("DATABASE_URL")` in `schema.prisma`. **Migrations are unaffected**: the
  Prisma CLI (`migrate deploy`) reads the schema's env directly, not the runtime client option — so
  `schema.prisma`'s datasource stays **untouched** and no migration changes.
- **Unset DATABASE_URL → pass `{}`** (no override) and let Prisma resolve the datasource exactly as
  today = **zero behavior change**. (`PrismaService` is only ever constructed in the Prisma wiring —
  `ProdAppModule` + `*.int.test.ts`; the default Docker-free `AppModule` uses in-memory
  `PersistenceModule` and never touches it.)

`onModuleInit` wraps `$connect()` in `connectWithRetry` (retry notices are **detail-free** — a Prisma
connect error can embed the DSN; the final rethrow surfaces Prisma's own error unmodified).
`onModuleDestroy` = `$disconnect()`, unchanged.

## 3. Deliverables

- `specs/slices/31-db-pool-config/README.md` — this spec. **Slice number 31**: the next unused number
  in `specs/slices/` is 29, but 29–30 are reserved for concurrent sibling streams, so 31 is used
  (per the program's parallel-worktree numbering guidance).
- `apps/api/src/persistence/prisma/pool-config.ts` — `PoolDefaults`, `DEFAULT_POOL_DEFAULTS`,
  `poolDefaultsFromEnv`, `withPoolDefaults`, `connectWithRetry` (all pure / framework-free).
- `apps/api/src/persistence/prisma/prisma.service.ts` — apply the augmented URL via `datasourceUrl`
  + the bounded connect-retry (`onModuleInit`/`onModuleDestroy` otherwise intact).
- `apps/api/src/persistence/prisma/pool-config.test.ts` — Docker-free unit tests (all AC).
- `apps/api/test/integration/db-pool.int.test.ts` — real-Postgres int test (boot + `SELECT 1`
  round-trip + readiness 200 through the augmented pool); **written but NOT run in this stream** —
  the orchestrator runs `test:int` at merge.

## 4. Out of scope / deferred

- No `.feature` / BDD scenario — this is a config/infra seam driven **SDD → TDD (unit)**, mirroring
  slice 27 (health readiness). The int test is the real-DB proof; unit tests cover the pure logic.
- No PgBouncer / external connection pooler, no `?pgbouncer=true` handling — single small replica for
  now; revisit if a pooler is introduced.
- No per-env matrix in `config.ts` — `PrismaService` reads `process.env` directly (the `*FromEnv`
  idiom); the pure helper is already independently unit-tested, so config injection buys little.
- Bicep already sets `DATABASE_URL`; the pool env knobs (`DB_*`) are optional overrides — wiring them
  into the container template is a trivial follow-up if operators want non-default sizing.
