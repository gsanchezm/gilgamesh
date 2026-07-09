# Slice 37 — Adopt the async-state primitives in Dashboard / Test Lab / Chat

> Slice number: **37**. `specs/slices/` runs 01–33 on `main`; 34–36 are reserved for sibling streams
> running in parallel worktrees (invisible from this worktree), so this slice claims **37** to avoid a
> merge collision — the same rationale slices 28 and 33 used.

## Why

Slice 28 landed three on-brand, accessible async-state components in `@gilgamesh/ui` — `Spinner`
(`role="status"` busy indicator), `ErrorState` (`role="alert"` failure panel + optional retry), and
`EmptyState` (icon + title + optional hint/CTA, **no** ARIA live role) — and slices 28/33 adopted them in
Reports, Billing, Integrations and Knowledge. The **remaining** screens still hand-roll these states:
`AgentRoomScreen` (`<p>Loading…</p>` + a bare `role="alert"` paragraph), `TestLabScreen` (`<p>Loading…</p>`
+ inline alert), `ChatScreen` (`<p className="gx-chat__railempty">No conversations yet.</p>` + inline
alert). This slice rolls the primitives out to those three so the whole app speaks **one** vocabulary for
the loading lifecycle.

**No keystone change, no backend, no new route, no new UI component** — a pure consistency refactor: JSX in
`apps/web/src/screens/*` swapped for the existing components, data flow / render conditions /
fetch-once-on-mount **unchanged**.

## Organizing principle (the slice-33 locked rule)

Adopt the **load-lifecycle** trio → primitives; leave **form / action / validation** errors as inline
alerts.

- A state driven by the screen's mount load (loading, loaded-but-empty, load-failure) → `Spinner` /
  `EmptyState` / `ErrorState` (with `onRetry` = the existing reload).
- A state driven by a user action or input validation (a toggle/wake/add/import/generate/send failure) stays
  an inline `role="alert"`. Those are **not** load failures — the re-trigger is the existing button, and
  converting them into "Something went wrong" panels would be a semantic + visual regression.
- **Retry correctness (rule b):** each adopted `load` clears its error at the top (`setError(null)`) so a
  successful retry does not leave a stale banner beside the loaded content.

## Scope — target screens

### `AgentRoomScreen` (Dashboard) — loading + load-failure

- **loading** — top-level `<p>Loading…</p>` (`data === null`) → `Spinner`.
- **load-failure** — top-level `<p role="alert">` (`error` set) → `ErrorState` wired with `onRetry` = the
  existing `load` `useCallback`. `load` gains `setError(null)` at the top for the retry.
- **No EmptyState — none invented.** The room is built server-side from a fixed 11-entry `AGENT_ROSTER`
  (`agent-room.ts` `AGENT_ROSTER.flatMap(...)`), so `data.agents.length === 0` is unreachable. Per "don't
  invent one", no empty state is added.
- **Left inline (action state):** the `actionError` banner (toggle / wake-all failures) — already a state
  distinct from the load `error`; kept as an inline `role="alert"`.

### `TestLabScreen` — loading + load-failure + loaded-empty

- **loading** — top-level `<p>Loading…</p>` (`slices === null`) → `Spinner`.
- **load-failure** — top-level `<p role="alert">` (`error && slices === null`) → `ErrorState` with
  `onRetry` = the existing `load`. `load` gains `setError(null)` at the top (previously only `action` did).
- **loaded-empty** — a new `EmptyState` banner shown when the lab genuinely has nothing yet
  (`slices.length === 0 && features.length === 0 && testCases.length === 0`). It **coexists** with the
  authoring sections (Add slice / Import / Add feature / Add test case / Generate) — it must **never**
  replace them, because you need the "Add slice" form to author the first slice. Placed right after the
  summary stats.
- **Left inline (action state):** the shared `error` banner shown while the lab is loaded (add /
  import / generate / run failures) — an action state, kept inline.

### `ChatScreen` — session rail only (initial-load + load-failure + empty), streaming untouched

Adopt the trio **inside the session rail (`<aside className="gx-chat__rail">`) only**. The conversation
pane, the composer, and the entire live SSE path are left byte-for-byte unchanged.

- **initial-load** — a new `sessionsLoaded` flag gates a rail `Spinner` on the first `listSessions` load
  only (never on the post-send `refreshSessions`, so no streaming flicker).
- **load-failure** — a new `sessionsError` (distinct from the conversation `error`) drives a rail
  `ErrorState` with `onRetry` = `refreshSessions`; cleared at the top of `refreshSessions` (rule b).
- **empty-conversations** — `<p className="gx-chat__railempty">No conversations yet.</p>` → `EmptyState`
  (title period dropped to match the convention).
- **Untouched (streaming non-perturbation):** `send`, `openLive`, the `DELTA`/`MESSAGE`/`DONE` handlers,
  the `pending` draft bubble, `resync`, `selectSession`, `newChat`, the pane's "Talk to the pantheon"
  empty prompt (entangled with `pending`), and the conversation `error` inline alert (send/select
  failures). The **only** edit to a shared path is `refreshSessions` writing `sessionsError` instead of the
  shared `error` — safe, because the DONE/resync callers do not depend on its error target.
- **Known delta (accepted):** the rail states are mutually exclusive and gated on `sessionsLoaded` (not on
  `sessions.length`), so a `listSessions` failure on the **post-send** `refreshSessions` (fired from the
  DONE handler) now shows the rail `ErrorState` in place of the session list, where before it surfaced via
  the shared pane `error` and kept the list visible. The streaming logic is byte-identical, retry recovers
  it, and no test regresses — so it is accepted rather than special-cased (swallowing the error to preserve
  the list would be worse).

## Acceptance

- **AC-37-01** — `AgentRoomScreen`: while the room loads it shows `Spinner` (`role="status"`); on a
  load failure it shows `ErrorState` (`role="alert"`) whose retry re-invokes the load and, on success,
  clears the error and renders the room. `actionError` (toggle/wake) stays an inline alert. Mount loads
  the room exactly once.
- **AC-37-02** — `TestLabScreen`: `Spinner` while loading; `ErrorState` + retry on load failure; an
  `EmptyState` banner when slices/features/test-cases are all empty, **coexisting** with the authoring
  forms; the banner is **absent** when any list has results. Every pre-existing assertion stays green.
- **AC-37-03** — `ChatScreen`: the session rail shows `Spinner` on the initial conversation load,
  `ErrorState` + retry on a rail-load failure, and `EmptyState` when there are no conversations; the
  banner is **absent** when conversations exist. The composer and the live SSE streaming behaviour are
  unchanged (all pre-existing streaming/send tests stay green).
- **AC-37-04** — Retry correctness: `AgentRoomScreen.load`, `TestLabScreen.load`, and
  `ChatScreen.refreshSessions` clear their error at the top so a successful retry leaves no stale banner.

## Design notes

- Touches only `apps/web/src/screens/{AgentRoom,TestLab,Chat}Screen.tsx` + their `.test.tsx`, plus this
  spec. **No** change to `packages/ui` (the components exist) and **no** change to `apps/web/src/index.css`
  (an entanglement point owned by other streams; the primitives carry their own CSS in
  `packages/ui/src/styles.css`).
- **Dead CSS left behind (deliberately):** `.gx-chat__railempty` becomes unused after the swap but stays in
  `index.css`; leaving it avoids the entanglement-point edit. Cleanup is a future housekeeping follow-up.

## Verification

- `pnpm --filter @gilgamesh/web test` — the three screen tests extended with the new roles/components, all
  pre-existing assertions preserved; the rest of the web suite stays green.
- `pnpm -r typecheck` · `pnpm lint`.
- **Not run here (shared-infra Tier-0 rule):** Playwright e2e / `test:int` / `test:bdd`. No e2e asserts any
  copy changed by this slice (verified by grep of `apps/web/e2e/*`).
