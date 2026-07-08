# Slice 32 — Web connection-lost banner

**Status:** DoD in progress · branch `feat-web-connection-banner` · web-only, no keystone, no backend, no route.

> Slice number: existing slices run 01–28. Slices 29–31 are reserved for the concurrent sibling
> worktrees (`feat-db-pool-config`, `feat-graceful-shutdown`, `feat-structured-logging`,
> `feat-ui-adopt-async-states`) whose specs are still uncommitted, so branch-checking can't see them.
> A gap is harmless while a collision is not — this stream takes **32** (the pre-named path).

## Problem

Slice 25 gave the HTTP layer a typed `HttpError` (`isNetwork` / `isTimeout`, `status: null` when there
is no response) plus per-attempt timeouts and bounded GET retries. But when the network genuinely drops
(Wi-Fi off, server unreachable, request timing out), each screen surfaces its own local failure — or,
for background fetches, nothing at all. A user whose connection is lost sees scattered per-screen errors
or silent stalls, with no single, honest "you are offline / reconnecting" signal.

## Goal

A **global, non-blocking connection banner**: the moment an API call fails with a *network/timeout*
`HttpError` (or the browser fires `offline` / `navigator.onLine` is false), a thin on-brand bar appears
("Connection lost — retrying…"). It clears automatically the instant connectivity returns (any request
reaches the server, or the browser `online` event fires), and is manually dismissible. Ordinary API
errors (4xx/5xx) are **not** a connection problem and never trigger it — those stay handled per-screen.

## Design (web only)

- **Reporter seam (`apps/web/src/lib/connection-status.ts`).** A tiny pub/sub — NOT a mutable status
  singleton. The HTTP layer only *emits*: `reportOnline()` when a request reaches the server (ANY HTTP
  status — a 4xx/5xx still proves connectivity), `reportOffline()` only when a request fails with a
  transport/timeout error (no response at all). `subscribeConnectivity(listener)` returns an unsubscribe.
  With no subscriber, emitting iterates an empty `Set` — a pure no-op — so the slice-25 HTTP
  behaviour and tests are **unchanged** (back-compat; `getJson`/`sendJson`/`ok`/`HttpError` signatures
  untouched).
- **`http.ts` change (minimal).** In `fetchWithResilience`: `reportOnline()` immediately before the single
  `return res` (covers every returned response — 2xx and 4xx/5xx alike; the `continue` on a retried
  502/503/504 is NOT a return, so no premature "online"); `reportOffline()` at each of the two terminal
  throws (the timeout abort and the exhausted network error). This is the exact network-vs-response
  discrimination point.
- **`ConnectionStatusProvider` (`apps/web/src/app/connection-status.tsx`).** Subscribes to the reporter
  seam AND to `window` `online`/`offline`, seeds initial state from `navigator.onLine`, and renders the
  banner. State is a primitive `online` boolean so `setOnline(true)` on every success is idempotent (React
  bails — no app-wide re-render churn). A `dismissed` flag hides it manually; it resets on the next
  recovery so a later outage re-shows. Mounted high in `App.tsx`, **outside** the top-level `ErrorBoundary`
  (connectivity is orthogonal to render crashes), inside `ThemeProvider`.
- **`ConnectionBanner` (`apps/web/src/components/ConnectionBanner.tsx`).** `role="status"` +
  `aria-live="polite"` live region (kept mounted so the insertion is announced), thin fixed bar at the top,
  `pointer-events` only on the bar itself (does NOT cover/block the app), amber `color-mix` styling (reads
  on both dark and light — the banner follows the persisted theme, so it can't be unconditionally dark),
  a dismiss (×) button.

## Acceptance criteria

- **AC-CONN-01** — a request failing with a network/timeout `HttpError` shows the global banner
  ("Connection lost — retrying…"), `role="status"` / `aria-live="polite"`, non-blocking (does not cover
  the app).
- **AC-CONN-02** — the banner clears when connectivity returns: a subsequent successful request, OR the
  browser `online` event.
- **AC-CONN-03** — it does **not** show for ordinary 4xx/5xx API errors (a reached-server response reports
  *online*; only network/timeout reports offline).
- **AC-CONN-04** — accessible and dismissible: the live region is announced; a dismiss control hides it;
  it auto-clears on reconnect and a fresh outage re-shows it.
- **AC-CONN-05** — `navigator.onLine` false at mount, and the `offline` window event, also raise the banner
  (belt-and-braces browser signals on top of the HTTP reports).
- **AC-CONN-06** (back-compat) — the reporter seam is a no-op with no subscriber; the slice-25 `http.ts`
  tests (fetch call counts, backoff `delays`, timing) pass **unchanged**.

## Out of scope / deferred

- No dedicated health-ping on manual retry (no new route; the app's slice-25 GET retries + screen
  re-fetches drive auto-recovery, and the banner reflects live connectivity). A "reconnect now" ping could
  be a later follow-up.
- No per-request queue/replay of failed mutations.
