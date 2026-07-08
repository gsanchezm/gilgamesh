# Slice 29 — Graceful shutdown (zero-downtime rolling deploys) (SDD Spec)

> Spec-Driven-Design spec for a keystone-free infra addition.
> Authority order: this is an **infra / deployment** concern (container lifecycle), NOT product
> vocabulary — confirmed by `grep -ri shutdown\|sigterm\|drain specs/_keystone/` returning nothing.
> No keystone change. Builds on slice 27 (health/readiness split).
> v0.1 — 2026-07-08. Status: BUILD SLICE. Branch `feat-graceful-shutdown`.

---

## 0. Why

Staging/prod runs on **Azure Container Apps** (`specs/infra/staging-deploy.md`). To roll out a new
revision (or scale a replica down) ACA sends the container **`SIGTERM`**, waits a termination grace
period, then **`SIGKILL`**. For a **zero-downtime** rollout the replica being retired must stop
receiving NEW traffic *before* it stops serving, while requests already in flight finish cleanly.

Slice 27 gave us the liveness/readiness split:

| Probe | Question | On failure ACA… |
| --- | --- | --- |
| **Liveness** `/api/v1/health` | "is the process alive?" | **restarts** the container |
| **Readiness** `/api/v1/health/ready` | "is it safe to send traffic?" | **holds traffic**, keeps it alive |

Today `SIGTERM` is handled only by Nest's `enableShutdownHooks()`, which tears the app down
**immediately** (Prisma `$disconnect` runs first, then the HTTP server closes) — so any request in
flight, and any request ACA routes in the window before it notices the replica is gone, can fail.

The fix is the standard drain sequence: on `SIGTERM`, **flip readiness to `not-ready` first** (ACA's
Readiness probe observes 503 and stops routing new traffic to this replica), keep serving for a short
**grace period**, then close cleanly. Liveness stays 200 the whole time — a not-ready-but-alive
replica must NOT be killed, only drained.

## 1. Acceptance criteria

- **AC-SHUT-01** — Before `SIGTERM`, `GET /api/v1/health/ready` is **200 `{ "status": "ready" }`**
  (unchanged slice-27 behaviour when the store is reachable).
- **AC-SHUT-02** — Once shutdown begins (a `draining` flag is set via `beginDraining()`),
  `GET /api/v1/health/ready` returns **503 `{ "status": "not-ready" }`** — **even if the DB probe
  would pass**. The drain check **short-circuits before** the readiness probe (proven with the
  in-memory `AlwaysReadyProbe` wiring: it would answer ready, yet readiness is 503 while draining).
- **AC-SHUT-03** — `GET /api/v1/health` (liveness) stays **200 `{ "status": "ok" }`** throughout —
  it **never** consults the drain flag or the DB (proven on the SAME app instance as AC-SHUT-02).
- **AC-SHUT-04** — The `SIGTERM` handler runs the sequence **`beginDraining()` → wait
  `shutdownGraceMs` → `app.close()`**: `beginDraining()` fires immediately (synchronously), the app is
  **not** closed before the grace elapses, and `app.close()` (which runs Nest's shutdown hooks →
  Prisma disconnect) fires exactly once after it. The handler is **idempotent**: a second `SIGTERM`
  during the grace window is a no-op (no double-drain, no double-close).
- **AC-SHUT-05** — During the grace/drain window (draining set, app not yet closed) the process still
  **serves** requests to completion (a request issued after `beginDraining()` still returns normally).
  *Scope note:* this asserts requests are served **during the drain window**; it does not (and cannot,
  Docker-free) assert in-flight survival **through** `app.close()`/`server.close()` keep-alive teardown.

## 2. Design — the shutdown-state seam

A tiny process-scoped state object, consulted by the readiness path and flipped by the SIGTERM handler.

- **`ShutdownState`** (`apps/api/src/health/shutdown-state.ts`) — an `@Injectable()` with
  `get draining(): boolean` + `beginDraining(): void` (monotonic: once true, stays true). It is
  **app-level, not persistence-level**, so it is bound **once in `APP_PROVIDERS`** (`app.module.ts`),
  shared by both the in-memory `AppModule` and the production `ProdAppModule` — NOT duplicated in the
  two persistence wirings. As a DI singleton the instance the `HealthController` injects is the SAME
  instance `main.ts` retrieves via `app.get(ShutdownState)` and flips — so `beginDraining()` is
  immediately visible to `/health/ready`. The two harnesses (`acceptance/support/hooks.ts`,
  `persistence.int.test.ts`) that spread `APP_PROVIDERS` without a `HealthController` just get a
  harmless, unused, no-dependency provider. Each `Test.createTestingModule` compilation gets a **fresh**
  instance, so a test that drains one app never poisons another.

- **Readiness consults it FIRST** (`HealthController.ready()`): if `shutdown.draining` → set 503 and
  return `{status:'not-ready'}` **before** calling `readiness.check()`. This keeps the `ReadinessProbe`
  port semantics pure ("is the backing store reachable?") — drain is a separate reason to refuse
  traffic, expressed in the controller, and it short-circuits the DB probe entirely (AC-SHUT-02).

- **Liveness is untouched** (`HealthController.check()`): still the constant `{status:'ok'}`, no
  `ShutdownState`, no DB (AC-SHUT-03).

## 3. Design — the SIGTERM handler & grace period

- **`createShutdownHandler(deps)`** (`apps/api/src/common/graceful-shutdown.ts`) — a pure, framework-
  free factory returning the signal handler. Deps: `{ beginDraining, close, graceMs, setTimeoutFn?,
  onClosed?, onError?, log? }`. On first call: `beginDraining()` synchronously, then schedule
  `close()` after `graceMs` via `setTimeoutFn` (injectable for unit tests); on settle call
  `onClosed()`/`onError()`. A `started` closure guard makes a second invocation a no-op (idempotency,
  AC-SHUT-04). No Nest, no `process`, no timers baked in → unit-testable with a fake timer + spies.

- **`main.ts` wiring:**
  1. `const shutdownState = app.get(ShutdownState);`
  2. **Carve `SIGTERM` out of Nest's auto-hooks** so Nest does not tear down immediately when the
     signal arrives (which would defeat the grace):
     `app.enableShutdownHooks(Object.values(ShutdownSignal).filter((s) => s !== ShutdownSignal.SIGTERM));`
     Every other default signal (SIGINT for dev Ctrl+C, SIGHUP, SIGQUIT, …) keeps Nest's existing
     immediate-close behaviour — the shutdown-hook **mechanism is unchanged**, only the ONE signal we
     drain is carved out. `app.close()` in our handler still runs all the same lifecycle hooks
     (`onModuleDestroy` → Prisma `$disconnect`), so Prisma still disconnects cleanly on SIGTERM.
  3. `process.on('SIGTERM', createShutdownHandler({ beginDraining: () => shutdownState.beginDraining(),
     close: () => app.close(), graceMs: config.shutdownGraceMs, onClosed: () => process.exit(0),
     onError: (e) => { Logger.error(...); process.exit(1); }, log: (m) => Logger.log(m, 'Bootstrap') }))`.

- **`shutdownGraceMs`** — new `ApiConfig` field from `SHUTDOWN_GRACE_MS` (default **10000 ms**,
  validated non-negative integer). Chosen so that (a) it exceeds ACA's Readiness probe
  `periodSeconds × failureThreshold` so new traffic actually stops before we close, and (b) it stays
  **under** ACA's container termination grace (default ~30 s) so we finish `app.close()` before SIGKILL.

## 4. Deliverables

- `specs/slices/29-graceful-shutdown/README.md` — this spec. Slice number **29** (last existing is 28).
- `apps/api/src/health/shutdown-state.ts` — the `ShutdownState` seam.
- `apps/api/src/common/graceful-shutdown.ts` — `createShutdownHandler` factory.
- `apps/api/src/health.controller.ts` — `ready()` consults `draining` first; `check()` untouched.
- `apps/api/src/app.module.ts` — `ShutdownState` added to `APP_PROVIDERS`.
- `apps/api/src/config.ts` — `shutdownGraceMs` (`SHUTDOWN_GRACE_MS`, default 10 s).
- `apps/api/src/main.ts` — carve SIGTERM out of Nest hooks + register the drain handler.
- `apps/api/test/graceful-shutdown.e2e.test.ts` — Docker-free e2e (AC-SHUT-01/02/03/05).
- `apps/api/src/common/graceful-shutdown.test.ts` — unit test of the handler sequence + idempotency (AC-SHUT-04).
- `apps/api/src/config.test.ts` — `shutdownGraceMs` default + validation.
- `apps/api/test/integration/graceful-shutdown.int.test.ts` — real-Postgres int test (ready→drain→503,
  liveness 200); **written but NOT run in this stream** — the orchestrator runs `test:int` at merge.

## 5. Out of scope / deferred

- No forced timeout / connection-tracking to abort stragglers at the end of the grace (Node
  `server.close()` waits for keep-alive connections; ACA's SIGKILL is the hard backstop). A
  connection-draining server wrapper is a future addition if needed.
- The ACA `terminationGracePeriodSeconds` / Readiness `periodSeconds`+`failureThreshold` tuning lives in
  `infra/bicep/**`, out of this api-only slice's scope; §3 documents the required relationship.
- Liveness stays at `/api/v1/health`; no `/live` alias (unchanged slice-27 contract).
