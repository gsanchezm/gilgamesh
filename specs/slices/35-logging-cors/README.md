# Slice 35 — Structured-logging completion + CORS expose header

Status: DoD in progress · Branch `slice-35-logging-cors` · No keystone · **api-only**

Closes three deferred follow-ups (programa v6 structured-logging deferrals + programa v5 CORS note):

1. **`bufferLogs: true`** so Nest's pre-`useLogger` bootstrap lines route through the JSON logger in
   json mode instead of escaping as pretty/ANSI.
2. **`JsonLogger.fatal()`** — the previously-unimplemented Nest `LoggerService.fatal?` level.
3. **CORS `exposedHeaders: ['X-Request-Id']`** so a cross-origin SPA can read the slice-24 correlation id.

## Why

- **Buffered bootstrap logs.** Slice 30's `JsonLogger` only takes over via `app.useLogger(...)`, which
  runs after `NestFactory.create(...)`. Nest emits several log lines during creation/init (`Starting
  Nest application…`, route mappings, `…successfully started`) through its default pretty
  `ConsoleLogger` **before** the override attaches — so in json mode those lines still shipped as
  multi-line ANSI text, unparseable for Azure Log Analytics. `bufferLogs` holds them until flush.
- **`fatal` hole.** Nest v11's `LoggerService.fatal?(message, …)` was unimplemented on `JsonLogger`.
  Latent today (no `.fatal` call sites), but a future fatal-level call would fall through to the
  interface default (Nest logs nothing for an unimplemented optional method) — a silent gap for the
  highest-severity level exactly when observability matters most.
- **CORS-hidden correlation id.** Slice 24 sets `X-Request-Id` on every response, but browsers expose
  only the CORS-safelisted response headers to `fetch`. Without `Access-Control-Expose-Headers`, a
  cross-origin SPA cannot read the id to quote in a bug report. Same-origin (vite proxy /
  single-container deploy) never needed it; a future split-origin SPA does.

## Changes

### 1. `bufferLogs` + explicit flush branch (`apps/api/src/main.ts`)

```ts
const app = await NestFactory.create<NestExpressApplication>(ProdAppModule, { bufferLogs: true });
const logger = selectLogger(config.logFormat);
if (logger) {
  app.useLogger(logger);   // json: override installed; buffered lines replay through it at flush
} else {
  app.flushLogs();         // pretty: drain the buffer now through the default ConsoleLogger, detach
}
```

**Pretty-mode zero-change invariant.** In pretty mode `selectLogger` returns `undefined`, so no override
is installed. `app.flushLogs()` immediately replays the handful of buffered create/init lines through
Nest's default `ConsoleLogger` and **detaches** the buffer, so every subsequent line prints live — the
same lines, same format, same order, none lost. (Nest's `autoFlushLogs` defaults `true`, so `listen()`
would flush the buffer anyway; flushing here keeps pretty-mode timing identical to pre-slice-35 rather
than deferring those first lines to `listen()`.) Net effect for dev and all four test harnesses (which
never set `LOG_FORMAT=json`): unchanged output.

**Json-mode mechanism (why it works).** For the HTTP `create()` path, `useLogger` does **not** self-flush
(only `createApplicationContext` arms `flushLogsOnOverride`). The flush json mode relies on is
`listen()`'s auto-flush (`autoFlushLogs ?? true`). Buffered items replay via
`Logger.flush()` → `item.methodRef(...)` → `get localInstance()`, which resolves the **active**
`staticInstanceRef` at flush time — i.e. the JSON logger installed by `useLogger`. So the buffered
bootstrap lines emit as single-line JSON; no pre-attach pretty line escapes.

### 2. `JsonLogger.fatal()` (`apps/api/src/common/json-logger.ts`)

`'fatal'` joins the `Level` union; `fatal(message, …optionalParams)` delegates to `emit('fatal', …)`.
`fatal` is an **error-severity** level (helper `isErrorLevel`): routed to **stderr** and parsed for a
trailing stack param, exactly like `error`. Record shape is byte-identical to `error`
(`{ level, time, context, message, stack? }`, same fixed allowlist), only `level` differs. Nest's real
`Logger` wrapper forwards `fatal` as `[stack?, context]` (output-equivalent to `error`, though `error`
pads `[undefined]` for a missing stack and `fatal` does not) — the trailing-string parsing handles both.

### 3. CORS expose header (`apps/api/src/main.ts`)

`app.enableCors({ …, exposedHeaders: [REQUEST_ID_HEADER] })`, reusing the `REQUEST_ID_HEADER`
(`'X-Request-Id'`) constant from `common/request-id.ts` (no drift vs. the header the middleware sets).
Emits `Access-Control-Expose-Headers: X-Request-Id` on CORS responses.

## Acceptance criteria

- **AC-LC-01** — `JsonLogger.fatal(...)` emits a single-line JSON record `{ level: 'fatal', time, context,
  message, stack? }` to **stderr**, with the same context/stack parsing and allowlist as `error`.
- **AC-LC-02** — With `LOG_FORMAT=json`, Nest's bootstrap lines emit as single-line JSON (no pretty/ANSI
  pre-`useLogger` line). *(Bootstrap-path; verified in the serial stack gate — see below.)*
- **AC-LC-03** — With `LOG_FORMAT` unset/`pretty`, log output is **unchanged**: buffered lines flush
  immediately through the default ConsoleLogger, buffer detaches, no lines lost. *(Serial stack gate.)*
- **AC-LC-04** — CORS responses carry `Access-Control-Expose-Headers: X-Request-Id`. *(Serial stack gate.)*
- **AC-LC-05** — **No new data in logs / no PII.** `JsonLogger` stays a pure reformatter; `fatal` adds no
  field beyond the existing allowlist. CORS exposes only the already-emitted `X-Request-Id` header.

## Verification boundary

Docker-free evidence (this worktree): the new `fatal` unit test + `pnpm -r typecheck && pnpm lint &&
pnpm -r test` green. `config.test.ts` is untouched (no config change) and stays green.

**Not exercisable Docker-free** (no server may start under the Tier-0 shared-infra rule; `main.ts` is not
run by the Docker-free harness): AC-LC-02/03 (bootstrap logging) and AC-LC-04 (CORS header). Manual /
serial checks for the reviewer:
- `LOG_FORMAT=json` boot → the first stdout lines (incl. `Starting Nest application…` / route maps) are
  single-line JSON objects.
- `LOG_FORMAT` unset boot → those same lines print pretty, none lost.
- A cross-origin response carries `Access-Control-Expose-Headers: X-Request-Id`. **Precondition:** boot
  with a non-empty `CORS_ORIGINS` and send an allowed `Origin` — with an empty allowlist `enableCors` uses
  `origin: false` (cross-origin disabled), so no `Access-Control-*` header appears (correct: nothing to
  expose when nothing is allowed), which is not a regression.

## Out of scope

Log shipping/agents, levels/sampling config, request-scoped context, redaction (unchanged from slice 30);
a real fatal call site (none exists yet); CORS beyond the single exposed header.
