# Slice 25 — Web HTTP resilience (timeout + bounded retry + typed error)

> Slice number: **25**. Number 24 is reserved for a sibling stream running in parallel, so this
> stream takes the next actually-free number (25).

## Why

For the imminent staging launch the web SPA must not **hang** on a slow/dead API, and a single
transient blip (a load-balancer 503, a dropped connection while a container recycles) must not
surface as a hard failure the user has to manually retry. The shared HTTP layer (`apps/web/src/lib/
http.ts`) — through which **every** typed client goes — gains three things:

1. a **request timeout** (via `AbortController`) so a stalled request fails fast instead of hanging;
2. a **bounded retry-with-backoff** for **idempotent GETs only**, on transient failures;
3. a **typed error** (`HttpError`) the screens and the slice-23 error boundary can branch on
   (`status` / `isTimeout` / `isNetwork`), while `.message` stays the human string it always was.

Web-only, UI resilience. No keystone change, no backend, no new route. Pairs with slice 23 (the
error boundary): the boundary catches *render* crashes; this slice makes *data-load* failures fast,
self-healing where safe, and distinguishable. TDD slice (SDD → TDD); no backend surface, so no
`.feature`/BDD.

## Scope

All three behaviours live behind the existing `getJson` / `sendJson` / `ok` primitives, whose
**signatures stay backward-compatible** (an optional trailing `opts` is added purely as a
test/tuning seam; no call site changes). Concretely:

- **GET (`getJson`) is idempotent → retryable.** On a *network error* (fetch rejects, not from our
  own abort) or a transient **502 / 503 / 504** response, it retries up to **N = 2** times with
  exponential backoff (**200 ms, 400 ms**), then gives up and throws the typed error.
- **Mutations (`sendJson`) are NON-idempotent → NEVER retried.** A retried POST/PATCH could
  double-create or double-charge. `sendJson` gets the timeout + typed error, but **zero** retries.
- **Timeout is terminal.** Each attempt is bounded by a **10 s** `AbortController` deadline. An
  abort rejects immediately with a typed `HttpError { isTimeout: true }` — it is **not** retried
  (a timeout already spent the full budget; stacking another 10 s budget would only slow the UX,
  and the spec groups timeout separately from the retryable failures below). NOT a hang.
- **4xx (and any non-{502,503,504} status) is terminal.** A client error is never retried; it
  surfaces the RFC 9457 `detail` (falling back to the caller's `fallback`) exactly as before.
- **500 and 429 are NOT in the transient set.** The retry set is exactly **{502, 503, 504}** (the
  classic gateway/unavailable statuses), matching the acceptance below. A bare 500 is usually an
  app bug, not a transient blip; 429 carries its own rate-limit semantics — neither is retried.

### Injectable timing (test seam)

`getJson`/`sendJson` accept an optional trailing `opts?: Partial<RetryPolicy>` merged over the
defaults, so tests inject an instant `sleep` and a tiny `timeoutMs` to stay fast + deterministic.
Production callers pass nothing and get the 10 s / 2-retry / 200-400 ms defaults.

```ts
interface RetryPolicy {
  retries: number;                        // idempotent GET retries (default 2 → 3 attempts max)
  timeoutMs: number;                      // per-attempt AbortController deadline (default 10_000)
  backoffMs: (attempt: number) => number; // 0-based → ms before the next try (default 200·2^n)
  sleep: (ms: number) => Promise<void>;   // injectable delay (default setTimeout)
}
```

## The typed error

```ts
class HttpError extends Error {
  readonly status: number | null;   // HTTP status, or null when there is no response (network/timeout)
  readonly detail: string;          // === .message (RFC9457 detail ?? fallback, or the network/timeout text)
  readonly isTimeout: boolean;      // aborted by our deadline
  readonly isNetwork: boolean;      // fetch rejected (connection refused/reset/DNS), not an abort
}
```

`HttpError extends Error` and `.message === .detail`, so every existing consumer that does
`catch (e) { show(e.message) }` or asserts `.rejects.toThrow(/detail/)` keeps working unchanged
(back-compat). The typed fields are additive — screens/the error boundary can now branch
(`if (e instanceof HttpError && e.isTimeout) …`).

## Acceptance

- **AC-HTTP-01** — A GET whose attempt exceeds the timeout rejects with an `HttpError`
  (`isTimeout === true`, `status === null`) — **not a hang** — and does not retry past the deadline.
- **AC-HTTP-02** — A GET that fails transiently (a **503**, or a thrown network error) then succeeds
  is **retried** and resolves with the eventual success payload (fetch called 2×, backoff slept once).
- **AC-HTTP-03** — A GET that returns **503** on every attempt **exhausts** the retries (3 attempts:
  1 + 2) and then throws an `HttpError` with `status === 503`.
- **AC-HTTP-04** — A **404** (client error) is **never retried** (fetch called exactly once) and the
  thrown `HttpError.message` equals the RFC 9457 `detail`.
- **AC-HTTP-05** — A mutation via `sendJson` that gets a **503** is **NOT retried** (fetch called
  exactly once) and throws the typed error — a non-idempotent request is never replayed.
- **AC-HTTP-06** — Back-compat: for an HTTP error the thrown value is `instanceof Error` with
  `.message` equal to the server `detail` (or the `fallback` when the body has none), so existing
  `catch`/`toThrow(.message)` consumers are unaffected; and a happy-path GET/POST still resolves the
  JSON exactly as before (the whole existing web suite stays green).

## Design notes

- `HttpError` lives in `apps/web/src/lib/http-error.ts`; `http.ts` imports + re-exports it so the
  single import surface (`./http`) is unchanged for clients.
- The retry loop creates a **fresh `AbortController` + timer per attempt** and always `clearTimeout`s
  (success and catch paths) — no leaked 10 s timers. On the retry path the discarded `Response` body
  is not consumed; the final `Response` is read once by `ok`.
- Network vs timeout is disambiguated by `controller.signal.aborted` inside the `catch` (our abort =
  timeout; any other rejection = network).
- `ok` now throws `HttpError(detail ?? fallback, { status })` instead of a bare `Error`.
- The Agents and Knowledge clients (which previously hand-rolled their own `fetch`) are routed through
  `getJson`/`sendJson` (review F1) so their GET reads — notably `getAgentRoom`, a primary dashboard
  load — gain the timeout + transient-retry instead of hanging forever on a stalled API. Their
  mutations go through `sendJson` (timeout + typed error, never retried). Nothing forced the old raw
  `fetch`: `getAgentRoom` is a plain GET, `knowledge.search` carries its query in the URL string, and
  `uploadDocument` sends `application/json` (not multipart).

## Verification

- `pnpm --filter @gilgamesh/web test` (Vitest + jsdom) — the new `http.test.ts` (AC-HTTP-01..06)
  plus the whole existing suite (must stay green — the resilience is transparent on the happy path,
  and every existing error test uses a non-transient status).
- `pnpm -r typecheck` · `pnpm lint`.
