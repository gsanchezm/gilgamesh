# Slice 27 — Health readiness probe (SDD Spec)

> Spec-Driven-Design spec for a keystone-free infra addition.
> Authority order: this is an **infra / deployment** concern (container orchestration), NOT product
> vocabulary — confirmed by `grep -ri health specs/_keystone/` returning nothing. No keystone change.
> v0.1 — 2026-07-07. Status: BUILD SLICE. Branch `feat-health-readiness`.

---

## 0. Why

Staging runs on **Azure Container Apps** (`specs/infra/staging-deploy.md`) with Postgres **stoppable**
for cost. The staging review flagged: on a **cold wake**, the DB may be unreachable for a few seconds
while it starts and while `prisma migrate deploy` runs on boot. Today the container exposes ONE probe
target — `/api/v1/health` — which is **liveness** (process up). If we naively made liveness depend on
the DB so ACA wouldn't route to a not-yet-ready replica, a DB-down would make ACA **kill and restart**
the container (crash loop) instead of merely holding traffic.

The fix is the standard Kubernetes/ACA split:

| Probe | Question | On failure ACA… | DB dependency |
| --- | --- | --- | --- |
| **Liveness** `/api/v1/health` | "is the process alive?" | **restarts** the container | **NONE** (must stay DB-free) |
| **Readiness** `/api/v1/health/ready` | "is it safe to send traffic?" | **holds traffic**, keeps it alive | **`SELECT 1`** (bounded) |

This slice adds the readiness endpoint + an ACA Readiness probe. Liveness is unchanged.

## 1. Acceptance criteria

- **AC-RDY-01** — `GET /api/v1/health` (liveness) is **unchanged**: 200 `{ "status": "ok" }`, a constant
  with **no DB dependency** — it returns 200 even while the database is unreachable (proven by driving
  the readiness probe to failure and asserting liveness still 200 on the SAME app instance).
- **AC-RDY-02** — `GET /api/v1/health/ready` returns **200 `{ "status": "ready" }`** when a cheap DB probe
  (`SELECT 1`) succeeds.
- **AC-RDY-03** — `GET /api/v1/health/ready` returns **503 `{ "status": "not-ready" }`** when the DB probe
  fails — a clean 503, **NOT a 500, NOT an unhandled throw** — so ACA holds traffic without crash-looping.
- **AC-RDY-04** — The readiness DB probe is **cheap and bounded**: a hung/slow DB yields 503 within a short
  timeout (`~2 s`, well under the ACA probe `timeoutSeconds: 5`), never a hanging HTTP probe.

## 2. Design — the in-memory-vs-Prisma seam

The `HealthController` is registered in **both** app compositions (`app.module.ts`): the Docker-free
in-memory `AppModule` (no Prisma) and the production `ProdAppModule` (`PrismaPersistenceModule`). The DB
probe exists only in the Prisma wiring. Resolution = **a port bound per wiring** (the repo's idiom):

- `ReadinessProbe` port — `apps/api/src/health/readiness.ts` (`check(): Promise<void>` — resolves when
  ready, **rejects** when the store is unreachable/slow). It lives in **`apps/api`**, NOT
  `@gilgamesh/application`: readiness is infra, the health controller already lives here, and the hard
  scope rule for this slice is `apps/api/**` + the one bicep file only.
- `AlwaysReadyProbe` — `apps/api/src/health/always-ready.probe.ts`: no external store to reach, so the
  in-memory wiring is trivially ready. Keeps the Docker-free e2e/BDD suites green.
- `PrismaReadinessProbe` — `apps/api/src/persistence/prisma/prisma-readiness.probe.ts`: `SELECT 1` via
  `PrismaService.$queryRaw`, wrapped in `Promise.race` against a `setTimeout` bound (default 2 s,
  `clearTimeout` on settle). Any query error OR the timeout **rejects** → the controller maps it to 503.

Both `PersistenceModule` and `PrismaPersistenceModule` are `@Global`, so the token they bind
(`TOKENS.Readiness`) resolves into the `HealthController` declared in the app module.

**Liveness/readiness separation (the load-bearing invariant).** The controller injects the probe at
**construction** time only (storing a reference touches no DB). The liveness handler `@Get()` returns the
constant `{status:'ok'}` and **never** calls `readiness.check()` — so even with the DB down, liveness is
200. Only `@Get('ready')` calls the probe. Proof lives in an e2e test that wires a **failing** probe and
asserts, on one app instance, `/health` = 200 `{ok}` AND `/health/ready` = 503 `{not-ready}`.

**503 body shape.** We set `res.status(503)` directly via `@Res({ passthrough: true })` and return
`{status:'not-ready'}`, rather than throwing `ServiceUnavailableException`. The global
`DomainExceptionFilter` (`@Catch()`) rewrites any `HttpException` into RFC9457 problem+json
(`{type,title,status,code,detail}`), which would NOT match AC-RDY-03's `{status:'not-ready'}`. Probes
match on the **status code**; the body is the documented contract for humans/tests.

**SPA fallback safety.** `apps/api/src/common/web-dist.ts` excludes the SPA catch-all for any path under
the `/api/v1` prefix (`path.startsWith('/api/v1/')`), so `/api/v1/health/ready` reaches the Nest handler
and never returns `index.html` (which ACA would misread as permanently "ready").

## 3. Deliverables

- `specs/slices/27-health-readiness/README.md` — this spec. **Slice number 27**: in this worktree the
  next free number is 24, but 24–26 are reserved for concurrent sibling streams, so 27 is used
  (per the program's parallel-worktree numbering guidance).
- `apps/api/src/health/readiness.ts` — the `ReadinessProbe` port.
- `apps/api/src/health/always-ready.probe.ts` — in-memory impl.
- `apps/api/src/persistence/prisma/prisma-readiness.probe.ts` — Prisma `SELECT 1` + timeout impl.
- `apps/api/src/persistence/tokens.ts` — `Readiness: 'ReadinessProbe'` token.
- `apps/api/src/health.controller.ts` — `@Get('ready')` handler (liveness `@Get()` untouched).
- `apps/api/src/persistence/persistence.module.ts` + `.../prisma/prisma-persistence.module.ts` — bind +
  export `TOKENS.Readiness` per wiring.
- `infra/bicep/modules/containerApps.bicep` — a `type: 'Readiness'` probe on `/api/v1/health/ready`.
- `apps/api/test/readiness.e2e.test.ts` — Docker-free e2e (AC-RDY-01/02/03, incl. the invariant proof).
- `apps/api/src/persistence/prisma/prisma-readiness.probe.test.ts` — unit test (AC-RDY-02/03/04).
- `apps/api/test/integration/readiness.int.test.ts` — real-Postgres int test (200 ready when DB up);
  **written but NOT run in this stream** — the orchestrator runs `test:int` at merge.

## 4. Out of scope / deferred

- No dependency-detail body (uptime, migration version, per-dependency status) — probes only need the
  status code; a richer readiness payload is a future addition if operators want it.
- No `/api/v1/health/live` alias — liveness stays at the existing `/api/v1/health` (unchanged contract).
- Redis is not probed (staging is single-replica with in-memory rate-limit/SSO stores; there is no Redis
  in the app-only deploy). If a multi-replica deploy adds `REDIS_URL`, extend the readiness probe then.
