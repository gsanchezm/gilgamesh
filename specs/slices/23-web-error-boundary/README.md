# Slice 23 — Web error boundary (UI resilience)

## Why

For the imminent staging launch, a runtime error thrown while a screen renders must **never** leave
the user staring at a blank white page (the default React behaviour: an uncaught render error
unmounts the whole tree). A crash should degrade to a recoverable, on-brand panel — and, where
possible, keep the surrounding app shell (sidebar + topbar) usable so the user can navigate away.

Web-only, UI resilience. No keystone change, no backend, no new route. This is a TDD slice
(SDD → TDD); there is no backend surface, so no `.feature`/BDD.

## Scope

A reusable React **error boundary** (a class component — `getDerivedStateFromError` +
`componentDidCatch`, the only React mechanism that catches render-phase errors) plus a default
on-brand fallback panel, wired at two levels:

1. **Inner boundary** — wraps the routed `<Outlet/>` inside `AppLayout`, **keyed by `pathname`**.
   An authenticated screen that crashes shows the fallback *inside the shell content slot*; the
   sidebar/topbar stay mounted and usable, and navigating to another route (which changes the key)
   remounts the boundary and auto-recovers. Renders **theme-aware** (dark by default; correct in a
   light shell too) — forcing dark inside a light shell would look broken.
2. **Top-level boundary** — wraps the router (inside `ThemeProvider`) as the last-resort catch-all
   for pre-auth screens (login/register/pricing/recovery) and for a crash in the shell/providers
   themselves. Because pre-auth is contractually **always-dark**, this boundary pins the dark
   palette on its fallback root (`data-theme="dark"`) regardless of the persisted theme.

### Out of scope (React limitations — stated so we don't over-claim)

Error boundaries do **not** catch errors from event handlers, `setTimeout`/async work, or SSR.
This slice covers **render / lifecycle** errors only. Data-load failures already surface as
in-screen alerts (e.g. `ReportsScreen`) and are unaffected.

## Acceptance

- **AC-EB-01** — When a child screen throws during render, the app shows a dark, on-brand
  "Something went wrong" panel instead of a blank page; the throw does not propagate out of the
  boundary.
- **AC-EB-02** — The panel carries (a) a brief, **fixed generic** message, (b) a "Try again" action
  that clears the error and re-mounts the children (recover in place) and a "Reload page" action
  (full `window.location.reload()`), and (c) **no leak** of the error message, stack, or any PII to
  the rendered UI. Error details are logged to the **console only, in dev** (`import.meta.env.DEV`).
- **AC-EB-03** — The fallback does **not** render for a normal (non-throwing) child; the boundary is
  transparent.
- **AC-EB-04** — When the inner boundary catches a screen crash, sibling shell chrome outside the
  boundary stays rendered (the shell survives); a route/key change recovers automatically.
- **AC-EB-05** — Accessibility: the fallback is announced (`role="alert"`), has a heading, and its
  actions are native, keyboard-focusable buttons.

## Design notes

- Component lives in `apps/web/src/components/ErrorBoundary.tsx` (app-local, alongside
  `TestLabSummaryStats`) — the fallback is app-specific and this keeps the change localized and off
  the `@gilgamesh/ui` build. It reuses `Card` + `Button` + CSS tokens from the design system; no new
  visual language.
- API: `ErrorBoundary` (`children`, optional `fallback: ({ reset }) => ReactNode` render-prop for
  tests, optional `alwaysDark`) and the exported `ErrorFallback` panel.
- Wiring: `apps/web/src/App.tsx` (top-level, `alwaysDark`) and `apps/web/src/app/AppLayout.tsx`
  (inner, `key={pathname}`).
- Styling: `.gx-errpanel*` classes appended to `apps/web/src/index.css`; sized relative to the
  parent (fills the shell content slot or the full page — never `100vh`, which would overflow the
  content slot).

## Verification

- `pnpm --filter @gilgamesh/web test` (Vitest + Testing Library, jsdom) — the new
  `ErrorBoundary.test.tsx` plus the existing `AppRoutes.test.tsx` (must stay green: the boundary is
  transparent with no error).
- `pnpm -r typecheck` · `pnpm lint`.
