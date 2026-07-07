# Slice 28 — Async-state primitives (Spinner / ErrorState / EmptyState)

> Slice number: **28**. `specs/slices/` currently runs 01–23; 24–27 are reserved for sibling streams
> running in parallel worktrees, so this slice claims **28** to avoid a merge collision.

## Why

Screens across the app hand-roll their loading / empty / error UI: a `<p>Loading...</p>` here, a bare
`<p className="gx-…__empty">No … yet</p>` there, a blank slot while a fetch is in flight
(`ReportsScreen` renders *nothing* during load), and a repeated `<p role="alert" class="gx-login__error">`
for every failure. The copy, layout and accessibility semantics drift per screen.

For the staging launch and every future screen we want **one** on-brand, accessible vocabulary for the
three async states, living in the design system (`@gilgamesh/ui`) so screens compose them instead of
re-inventing them.

Design-system-only + one screen adoption. **No keystone change, no backend, no new route.** TDD slice
(SDD → TDD); there is no backend surface, so no `.feature`/BDD.

## Scope

Three small, composable, theme-aware, screen-reader-accessible components in `@gilgamesh/ui`, reusing the
existing tokens (`styles.css` §11) and the existing `Button` — **no new visual language, no new tokens**:

1. **`Spinner`** — an accessible busy indicator. A rotating ring (reuses the already-present, unused
   `gxspin` keyframe) plus a **visually-hidden** text label so assistive tech announces it. `role="status"`;
   the label is the element's accessible name. Size prop (`sm | md | lg | number`). Honors
   `prefers-reduced-motion`.
2. **`ErrorState`** — icon + title + message, `role="alert"`, dark-aware. Optional **retry action** button
   (reuses `Button variant="secondary"`); when `onRetry` is absent no button renders.
3. **`EmptyState`** — icon + title + optional hint, plus an optional **CTA** button (reuses `Button`). Static
   content, so **no ARIA live role** (an empty state is not an alert/status); when `action` is absent no CTA
   renders.

Two stroke icons (`IconAlert`, `IconInbox`) are added to `icons.tsx` via the shared `Svg` frame
(handoff §7 — stroke icons, no emoji); both components accept an optional `icon` override.

### Adoption (proof-of-use) — `ReportsScreen`

`apps/web/src/screens/ReportsScreen.tsx` is the one screen adopted, because it exhibits all three states,
mutually exclusive, at one clean level:

- **loading** — currently paints **blank** (the `loading` boolean exists; nothing renders). Adopting
  `Spinner` fills that blank — this is "fill the blank loading slot", not "swap `Loading…` text".
- **empty** — `No runs yet …` → `EmptyState` (the copy is preserved as the title so coverage is unchanged).
- **error** — the `role="alert"` `<p>` → `ErrorState`, wired with `onRetry` = the existing `listRuns` load.

**Behavior is unchanged**: the data flow and the render conditions (same `runsClient.listRuns`, same
loading / empty / error gates) are identical. The retry button and the visible spinner are *new
affordances* mandated by AC-ASYNC-04/05 below (the point of the slice), added under the **existing**
conditions — no new data path. To wire retry, the mount effect is refactored to call a `useCallback`'d
`load` (mirroring `BillingScreen`), preserving the exactly-once-on-mount call.

`ReportsScreen` is not yet route-wired (known, pre-existing); a unit-tested screen is sufficient proof for
this design-system slice.

## Acceptance

- **AC-ASYNC-01** — `Spinner` renders `role="status"`, exposes its `label` as the accessible name via a
  visually-hidden node (not `display:none`), and hides the animated ring from AT (`aria-hidden`). The size
  prop drives the ring dimensions (`sm|md|lg` presets or an explicit number).
- **AC-ASYNC-02** — `ErrorState` renders `role="alert"`, shows the title + message, and renders a retry
  button **only** when `onRetry` is provided; clicking it fires `onRetry`. Default title/retry copy exist;
  `retryLabel` overrides the button text.
- **AC-ASYNC-03** — `EmptyState` shows the title (+ optional hint), renders a CTA button **only** when
  `action` is provided; clicking it fires `action.onClick`. It carries **no** ARIA live role.
- **AC-ASYNC-04** — All three reuse existing tokens/`Button`, are theme-independent (no hard-coded palette),
  and Spinner degrades under `prefers-reduced-motion`.
- **AC-ASYNC-05** — `ReportsScreen` adoption: while loading it shows the `Spinner` (`role="status"`); with no
  runs it shows `EmptyState` (the `No runs yet` copy preserved); on load failure it shows `ErrorState`
  (`role="alert"`) whose retry re-invokes `runsClient.listRuns`. Every pre-existing `ReportsScreen` assertion
  stays green; the mount still calls `listRuns` exactly once.

## Design notes

- New files: `packages/ui/src/Spinner.tsx`, `ErrorState.tsx`, `EmptyState.tsx` (+ `.test.tsx` each),
  exported from `packages/ui/src/index.ts`.
- CSS: `.gx-spinner*`, `.gx-astate*` and the shared visually-hidden `.gx-vh` helper are added to
  **`packages/ui/src/styles.css`** (design-system styles) — **never** `apps/web/src/index.css` (an
  entanglement point owned by other streams). The `gxspin` keyframe already exists and is reused.
- Icons: `IconAlert`, `IconInbox` added to `packages/ui/src/icons.tsx` (shared `Svg` frame). Components take
  an optional `icon` override.

## Verification

- `pnpm --filter @gilgamesh/ui test` — the three new `*.test.tsx` (RED first).
- `pnpm --filter @gilgamesh/web test` — `ReportsScreen.test.tsx` updated to the new roles, all existing
  assertions preserved; the rest of the web suite stays green.
- `pnpm -r typecheck` · `pnpm lint`.
