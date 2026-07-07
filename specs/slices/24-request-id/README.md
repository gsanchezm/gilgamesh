# Slice 24 — Request/response correlation ids (API observability)

## Why

For the imminent staging launch the API runs in Azure Container Apps with logs shipped to Log
Analytics. When a user reports "I got an error", or an alert fires on a 500, we need to correlate the
**exact** client-visible failure with the matching server log line. Today an error response carries
no id, so there is no join key between the browser and the server logs.

This slice gives every HTTP request a **correlation id** that is: echoed on the response header,
embedded in the RFC9457 error body (so a user can quote it), and written into the server log for any
unmapped 500 (alongside the stack). One id, stable across header · body · log for a single request.

API-only, infra/observability. **No keystone change** (the `Problem` DTO in the keystone is not
field-enumerated — RFC9457 permits additive extension members, so `requestId` is additive and the
five existing members `type·title·status·code·detail` are untouched). **No new route, no migration.**
This is an SDD → TDD slice; the real gate is an api e2e (supertest) test — there is no new domain
vocabulary, so no `.feature`/BDD is natural here.

## Scope

A small, framework-light Express middleware (`apps/api/src/common/request-id.ts`) registered in
`main.ts`, plus a read of the id inside the existing `DomainExceptionFilter`. Nothing in
`packages/domain` or `packages/application` — the domain/application layers stay framework-free; the
correlation id is a pure transport/infra concern and lives entirely in `apps/api`.

### Out of scope

- Propagating an incoming W3C `traceparent` / distributed-tracing context (a later observability
  slice if we adopt OpenTelemetry). This slice standardizes on a single opaque `X-Request-Id`.
- Exposing the header to a cross-origin browser fetch via `Access-Control-Expose-Headers`. The
  client-facing correlation contract is the **error body** (`requestId`), which JSON-parses freely
  regardless of CORS; the header is for proxies / same-origin / server logs. Adding the id to the
  exposed-headers allowlist is a trivial, isolated follow-up if a browser ever needs to read it off a
  2xx response, and is deliberately left out to keep the CORS surface minimal.

## Acceptance

- **AC-RID-01** — Every HTTP response carries an `X-Request-Id` header holding the request's
  correlation id.
- **AC-RID-02** — A client-supplied `X-Request-Id` is **trusted and echoed** when it is a sane opaque
  token: non-empty, length ≤ 128, and matching charset `[A-Za-z0-9._-]+`. The same id then appears on
  the response header, in any error body, and in the log.
- **AC-RID-03** — A client-supplied `X-Request-Id` that is over-long (> 128), empty, or contains any
  character outside the safe charset (e.g. CR/LF, space, `:`, `<`, `;`, a JSON payload) is **not
  reflected**: it is replaced by a fresh server-generated id. Arbitrary client input never reaches the
  response header (header-injection) or the server log (log-injection) unbounded/unsanitized.
- **AC-RID-04** — The RFC9457 error body gains an **additive** `requestId` member. The five existing
  members (`type`, `title`, `status`, `code`, `detail`) are unchanged, so every existing error-body
  consumer keeps working. `requestId` equals the response `X-Request-Id` header for the same request.
- **AC-RID-05** — An unmapped error (the generic 500 branch) logs the correlation id together with the
  stack (`this.logger.error`), so an alert on a 500 log line can be joined to the client's `requestId`.
- **AC-RID-06** — The id is **stable within one request**: response header == error-body `requestId`
  == the value logged. It does not change between the middleware assigning it and the filter reading
  it.

## Design notes

### Sanitization rule (security)

A correlation id flows into two injection-sensitive sinks: the HTTP **response header** (an
unescaped CR/LF could split the response / inject headers) and the **server log line** (a newline
could forge a fake log record — log injection). We therefore never echo an arbitrary client header.
Accepted iff **all** of: `typeof === 'string'` · `1 ≤ length ≤ 128` · matches `^[A-Za-z0-9._-]+$`.
The charset excludes every control character (CR, LF, tab), whitespace, `:`, `;`, `<`, `>`, quotes and
JSON punctuation — so a trusted id is safe to concatenate into a header value and a log line. Anything
failing the check is dropped and a fresh id is generated; the raw client value is never logged.

Length 128 is generous headroom over any real generator (a UUID is 36 chars) while bounding the bytes
an attacker can push into logs per request. A duplicated header (`X-Request-Id: a` twice) arrives as
`"a, b"` from Express and fails the charset check (comma + space) → regenerated. Safe by default.

### Id generation

Server-generated ids use `crypto.randomUUID()` (Node built-in, zero extra dependency, RFC4122 — its
`[0-9a-f-]`, 36-char output is itself inside the accepted charset/length, which is load-bearing: the
filter re-normalizes the header the middleware wrote, so a generated id must pass its own check to stay
stable — AC-RID-06). This is the framework-light option the task prefers; the domain `IdGenerator`
(uuid v7) port is not injected into a plain Express middleware.

### Placement & the "error before the middleware" question

`configureRequestId(app)` is registered **first** in `main.ts` — before `configureBodyParser` — so
even a body-parser error (413/malformed body, thrown by Express body-parser middleware) is raised
*after* the id is assigned and thus carries it. Belt-and-suspenders, though correctness does **not**
depend on this ordering: the `DomainExceptionFilter` fallback independently normalizes the raw request
header and sets the response header itself, so it can always produce a stable id even if it somehow
runs before the middleware. (This is proven by the flagship e2e: an oversized body — a
body-parser-layer error — with a garbage client id still yields a fresh valid `requestId` that equals
the response header.) The middleware writes the normalized id back onto `req.headers['x-request-id']`
(single source of truth) and echoes it on the response; the filter reads that same header, so the two
never diverge.

### Files

- `apps/api/src/common/request-id.ts` — `REQUEST_ID_HEADER`, `REQUEST_ID_MAX_LENGTH`,
  `normalizeRequestId(supplied)`, `resolveRequestId(req, res)`, `configureRequestId(app)`.
- `apps/api/src/common/domain-exception.filter.ts` — reads `resolveRequestId(req, res)`, adds the
  additive `requestId` body member, and appends the id to the unmapped-500 log line.
- `apps/api/src/main.ts` — `configureRequestId(app)` registered first.
- Tests: `apps/api/test/request-id.e2e.test.ts` (supertest gate) + a `requestId` case added to
  `apps/api/src/common/domain-exception.filter.test.ts`.
</content>
</invoke>
