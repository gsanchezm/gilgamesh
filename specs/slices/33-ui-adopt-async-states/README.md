# Slice 33 — Adopt the async-state primitives across more screens

> Slice number: **33**. `specs/slices/` runs 01–28 on `main`; 29–32 are reserved for sibling streams
> running in parallel worktrees (they are invisible from this worktree), so this slice claims **33** to
> avoid a merge collision — the same rationale slice 28 used to claim 28 over 24–27.

## Why

Slice 28 landed three on-brand, accessible async-state components in `@gilgamesh/ui` — `Spinner`
(`role="status"` busy indicator), `ErrorState` (`role="alert"` failure panel + optional retry), and
`EmptyState` (icon + title + optional hint/CTA, no ARIA live role) — but only adopted them in
`ReportsScreen`. Every other screen still hand-rolls these states: a `<p>Loading...</p>` here, a bare
`<p className="gx-…__empty">No … yet</p>` there, a repeated `<p role="alert" class="gx-login__error">`
for failures. The copy, layout and accessibility semantics drift per screen.

This slice rolls the primitives out to the next screens so the app speaks **one** vocabulary for the three
async states. **No keystone change, no backend, no new route, no new UI components** — this is a pure
consistency refactor: JSX in `apps/web/src/screens/*` is swapped for the existing components, with the
data flow, render conditions and fetch-once-on-mount behaviour **unchanged**.

## Organizing principle (what gets swapped, what stays)

Adopt the **load-lifecycle** trio → primitives; leave **form / action / validation** errors as inline
alerts.

- A state driven by the screen's mount load (loading, loaded-but-empty, load-failure) → `Spinner` /
  `EmptyState` / `ErrorState` (with `onRetry` = the existing reload when a retryable load exists).
- A state driven by a user action or input validation (an upload/search/connect/plan-change failure, a
  validation message like "Only .pdf…") stays an inline `role="alert"` — those are not load failures, the
  re-trigger is the existing button, and one is pure validation. Converting them into "Something went
  wrong" panels would be a semantic + visual regression.

This one rule resolves every per-screen decision below.

## Scope — target screens

### `BillingScreen` — loading + load-failure (canonical, mirrors ReportsScreen)

- **loading** — top-level `<p className="gx-billing__loading">Loading...</p>` (`sub === null`) →
  `Spinner`.
- **load-failure** — top-level `<p role="alert">` (`error && sub === null`) → `ErrorState` wired with
  `onRetry` = the existing `load` `useCallback`.
- **Left inline (action states):** the mid-screen plan-change error banner, and the AI-usage / invoices
  panels' own inline "Loading…/No … yet/failed" degradation copy — those are partial-degradation and
  action states with pinned copy, not the top-level trio.

### `IntegrationsScreen` — load-failure only

- **load-failure** — the inline `<p role="alert">` → `ErrorState` in the **same slot** (above the grid),
  wired with `onRetry` = the existing `load` `useCallback`.
- No loading or empty state exists today → **none is invented** (the screen paints nothing until the
  catalog resolves, and renders no explicit "no integrations" empty).
- **Known quirk (flagged):** that error slot is *shared* with connect/disconnect action failures, so retry
  reloads the catalog rather than re-running the failed action. Acceptable — a reload is a valid recovery —
  but noted for review.

### `KnowledgeScreen` — loaded-empty only (×2)

- **documents empty** — `<p className="gx-kb__empty">No documents uploaded yet.</p>` → `EmptyState` (copy
  preserved as the title; the trailing period is dropped to match the ReportsScreen `No runs yet`
  convention).
- **search empty** — `<p className="gx-kb__empty">No matches.</p>` → `EmptyState` (same period drop).
- **Left inline (action/validation states):** the upload error and the search error. Both are
  action-triggered `role="alert"` messages (upload includes pure validation — "Only .pdf, .docx, .md, and
  .txt files are supported."), and the mount document-load error is deliberately swallowed (leaves the
  empty state) — so there is no retryable load behind them.
- No loading state exists (the document load is silent; search has a `Searching…` button label, not a
  standalone spinner block) → **none is invented**.

The trio is therefore covered across the three screens even though no single screen exhibits all three:
Billing (loading + error), Integrations (error), Knowledge (empty). This unevenness is intentional — each
screen adopts only the states it already hand-rolls.

## Acceptance

- **AC-ADOPT-01** — `BillingScreen`: while the subscription is loading it shows `Spinner` (`role="status"`);
  on a subscription-load failure it shows `ErrorState` (`role="alert"`) whose retry re-invokes the load and,
  on success, clears the error and renders the loaded screen. Every pre-existing assertion stays green; the
  mount loads the subscription exactly once.
- **AC-ADOPT-02** — `IntegrationsScreen`: on a catalog-load failure it shows `ErrorState` (`role="alert"`)
  whose retry re-invokes `list` and, on success, clears the error and renders the catalog. Every pre-existing
  assertion stays green; the mount loads the catalog exactly once.
- **AC-ADOPT-03** — `KnowledgeScreen`: with no indexed documents it shows `EmptyState` (the
  `No documents uploaded yet` copy preserved); a search returning zero matches shows `EmptyState`. Every
  pre-existing assertion stays green; the mount lists documents exactly once.
- **AC-ADOPT-04** — Behaviour is unchanged: identical data paths (`getSubscription`/`list`/`listDocuments`
  + `search`), identical render conditions, identical fetch-once-on-mount. The only new affordances are the
  retry buttons (added under the **existing** load-failure conditions) — no new data path.
- **AC-ADOPT-05** — Retry correctness: each adopted `load` clears its error at the top
  (`setError(null)`) so a successful retry does not leave a stale error banner beside the loaded content.

## Design notes

- Touches only `apps/web/src/screens/{Billing,Integrations,Knowledge}Screen.tsx` and their `.test.tsx`,
  plus this spec. **No** change to `packages/ui` (the components exist) and **no** change to
  `apps/web/src/index.css` (an entanglement point owned by other streams; the primitives carry their own
  CSS in `packages/ui/src/styles.css`).
- **Dead CSS left behind (deliberately, not touched):** `.gx-billing__loading` and `.gx-kb__empty` become
  unused after the swap but live in `index.css`; leaving them avoids the entanglement-point edit. Cleanup is
  a future housekeeping follow-up.
- Retry fix (AC-ADOPT-05): `BillingScreen.load` and `IntegrationsScreen.load` gain `setError(null)` at the
  top (matching the ReportsScreen canonical) — no observable change on mount (error starts null).
- No `active`-guard is introduced: both Billing and Integrations already have `useCallback` loads, and
  Knowledge's document-load effect (untouched) already carries its own `active` flag.

## Verification

- `pnpm --filter @gilgamesh/web test` — the three screen tests updated to the new roles/components, all
  pre-existing assertions preserved; the rest of the web suite stays green.
- `pnpm -r typecheck` · `pnpm lint`.
