# Slice 30 — Structured JSON logging (deploy observability)

Status: DoD in progress · Branch `feat-structured-logging` · No keystone · **api-only**

> Slice number: `29` was left free for a sibling stream in the parallel programme; this stream
> takes the next number, **30** (highest committed slice in this worktree was `28-ui-async-states`).

## Why

The staging/prod target is **Azure Container Apps → Azure Log Analytics**, which ingests container
stdout/stderr **line-by-line** and can parse structured fields only when each line is a single JSON
object. Nest's default `ConsoleLogger` prints human-pretty, multi-line, ANSI-coloured text — great for
a dev terminal, unparseable for Log Analytics (no queryable `level`/`context`, colour codes as noise,
a stack trace fragments across many "log entries"). This slice adds an **opt-in JSON log format**,
gated by env, so the deployed container emits machine-parseable lines while local dev/tests keep the
existing pretty logger unchanged.

## Scope

- A custom `LoggerService` (`JsonLogger`) that emits **one single-line JSON object per log call**.
- A `logFormat` config knob (`LOG_FORMAT`, `'pretty' | 'json'`, default `'pretty'`).
- A `selectLogger(logFormat)` selector, wired in `main.ts` via `app.useLogger(...)` **only** for
  `LOG_FORMAT=json`.

**Out of scope (deliberately):** log shipping/agents (the platform tails stdout), log sampling/levels
config, request-scoped context via AsyncLocalStorage (see *Request correlation* below), redaction
rules (this feature adds **no** new data to logs — it only reformats existing calls).

## Acceptance criteria

- **AC-LOG-01** — With `LOG_FORMAT=json`, every log call emits a **single-line JSON object** carrying at
  least `{ level, time, context, message }`. `time` is an ISO-8601 string; `level` is the Nest log level
  (`log | error | warn | debug | verbose`); `context` is the Nest logger context (the `new Logger(<ctx>)`
  name, e.g. `Bootstrap`, `DomainExceptionFilter`); `message` is the log message.
- **AC-LOG-02** — Default behaviour (`LOG_FORMAT` unset, or any value other than `json`) is **unchanged**:
  `selectLogger` returns `undefined`, `main.ts` never calls `app.useLogger`, so Nest's pretty
  `ConsoleLogger` stays in force. **Zero** behaviour change for dev and for the whole test suite.
- **AC-LOG-03** — The emitted JSON is **valid single-line JSON**: a multi-line message (or an error
  stack) is encoded (`\n` escaped by `JSON.stringify`) so no raw newline splits one log call across
  multiple ingestion lines. Exactly one trailing `\n` terminates the record.
- **AC-LOG-04** — **No secrets added.** This feature only reformats the *existing* message/context/stack
  from current log calls. It reads no env, config, headers, cookies, or request bodies; it introduces no
  new field sourced from anything sensitive. The JSON record's keys are a fixed allowlist
  (`level, time, context, message` + optional `stack`).

## Design

### `JsonLogger` (implements Nest `LoggerService`)

Implements the five Nest methods `log` / `error` / `warn` / `debug` / `verbose`. Each builds a plain
record and writes `JSON.stringify(record) + '\n'` to a stream (`error` → `process.stderr`, all others →
`process.stdout`, mirroring Nest's own stream split so error severity is preserved for the platform).

Record shape:

```json
{"level":"log","time":"2026-07-08T00:00:00.000Z","context":"Bootstrap","message":"Gilgamesh API listening on :3001/api/v1 (production)"}
```

- `level` — the method name, i.e. Nest's `LogLevel` string, unchanged.
- `time` — `now().toISOString()`; the clock is injectable for deterministic tests.
- `context` — extracted from the Nest call. Nest's `Logger` wrapper appends the instance's bound context
  as the **trailing** param, so a `new Logger('X').log(msg)` arrives as `log(msg, 'X')` and a
  `new Logger('X').error(msg, stack)` arrives as `error(msg, stack, 'X')`. `JsonLogger` therefore reads
  the **last string** optional param as `context` (defaulting to `Application` when a context-less call
  is made), and — for `error` — the **preceding** string as `stack`. *This forwarding contract is
  verified empirically through the real `Logger.overrideLogger` path, not assumed* (see tests).
- `message` — the message coerced to a string (objects → `JSON.stringify`, falling back to `String`),
  then carried as a JSON value so `JSON.stringify` escapes any embedded newline. The whole
  `JSON.stringify` is wrapped in a try/catch so a pathological payload (circular / BigInt) degrades to a
  minimal safe line and can never crash the process from the logging path.
- `stack` — present only for `error` calls that carry a stack/trace param.

### `selectLogger(logFormat)`

```
selectLogger('json')     → new JsonLogger()          // main.ts calls app.useLogger(it)
selectLogger('pretty')   → undefined                 // Nest default pretty logger, untouched
selectLogger(<other>)    → undefined                 // (logFormat is already normalized in config)
```

Returning `undefined` (rather than a pass-through logger) is the zero-change guarantee: `main.ts` guards
`if (logger) app.useLogger(logger)`, so the unset path never touches the logger at all.

### Config

`loadConfig` gains `logFormat: 'pretty' | 'json'` from `LOG_FORMAT` (trimmed, case-insensitive), default
`'pretty'`; any unrecognised value falls back to `'pretty'` (fail-safe: a typo never silently loses the
pretty logger *nor* accidentally selects an unknown mode).

### Request correlation (requestId)

The request correlation id (slice 24) is **not** added as a separate top-level JSON field. It already
rides inside the `message` on the only place it is logged — the `DomainExceptionFilter`'s unmapped-500
line `Unhandled error [requestId=<id>]` — and the JSON format preserves that text verbatim, so
Log Analytics can still `matches regex "requestId=([^ \]]+)"`. Threading the id per-log-call would
require request-scoped `AsyncLocalStorage`, which the task explicitly rules out as too fragile for the
value: the correlation id is already present where it matters (the error path), and the join key
(response header · error body · 500 log) is unchanged. This keeps the slice focused on **format**.

## Known deltas / notes

- `JsonLogger` does not implement `setLogLevels`, so in `json` mode `debug`/`verbose` are not gated the
  way Nest's default logger gates them by env. Harmless today: a grep confirms the app logs only at
  `log`/`warn`/`error`. Documented for a future reviewer; a level gate can be added if debug logging is
  introduced.
- `error` writes to `stderr`, all other levels to `stdout` — matching Nest's stream split so the platform
  keeps error severity.

## Verification

- Unit: `pnpm --filter @gilgamesh/api test` — `JsonLogger` per-level JSON shape, single-line multi-line
  encoding, the `Logger.overrideLogger` real-path context/stack extraction, and the `selectLogger`
  branch (json → logger, unset/pretty → `undefined`).
- Zero-change: the full api suite runs with `LOG_FORMAT` unset (default pretty path) and stays green at
  its prior count.
- `pnpm -r typecheck` · `pnpm lint`.
