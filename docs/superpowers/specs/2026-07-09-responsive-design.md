# Responsive design pass — spec (2026-07-09)

## Problem

On mobile (a real iPhone against the live staging origin, video from a stakeholder) the authenticated
app looks broken: KPI cards squished into a narrow center column, a large empty area to the right, and
the agents rail reduced to a strip of 2-letter tags. Root cause (confirmed in code, not the viewport
meta — that is correct):

```css
/* packages/ui/src/styles.css — NO @media anywhere for the shell */
.gx-shell   { display: grid; grid-template-columns: auto 1fr; }
.gx-sidebar { width: 236px; }   /* fixed at every width */
```

The authenticated shell has **zero mobile adaptation**: the sidebar stays a fixed 236px column, stealing
~60% of a ~390px viewport and forcing horizontal overflow. Per-screen `@media` rules exist scattered in
`apps/web/src/index.css`, but the shell squish dominates on every authenticated view regardless.

## Decisions (owner-approved 2026-07-09)

- **Mobile nav = off-canvas drawer** opened by a hamburger (☰) in the Topbar; content full-width; backdrop.
- **Scope = the shell + all authenticated screens** (Dashboard, Test Lab, Chat, Billing, Integrations,
  Knowledge, Reports). Pre-auth (Login/Register helix hero) is a **separate later phase** if still needed.
- **Chat sessions rail on mobile = drawer/toggle** (a "Conversations" button slides the session list in as
  a panel; the conversation is full-screen). Same pattern as the shell drawer. **The SSE path is untouched.**
- **Execution = ONE cohesive stream** (not a 5-way worktree fanout): responsive lives in shared CSS
  (`packages/ui/src/styles.css` + `apps/web/src/index.css`), exactly the files the parallel-worktree memory
  flags as entangling. Phased shell→screens, per-view screenshot verification (the look&feel cadence).

## Breakpoints (one consistent set)

- **mobile** `≤ 767px` — the drawer + single-column reflow live here.
- **tablet** `768–1023px` — light adjustments (denser grids collapse from 3→2 cols where needed).
- **desktop** `≥ 1024px` — **unchanged; zero regression** (this is the hard invariant of the whole pass).

## Phase 0 — baseline

Bring up the local stack (docker Postgres/Redis already up → `api start:dev` + `web dev`). A throwaway
Playwright script logs in (demo user) and screenshots each authenticated screen at **iPhone (390×844)** and
**tablet (768×1024)**; `Read` the PNGs to confirm the diagnosis and record the before-state per screen.
(Kill stale 3001/5173 first so the dev servers boot fresh.)

## Phase 1 — the shell drawer (`packages/ui` + `apps/web` wiring)

**Component API (additive, desktop behavior unchanged):**
- `AppShell`/`Sidebar`/`Topbar` gain a **mobile-nav** channel distinct from the desktop `collapsed`:
  `mobileNavOpen: boolean`, `onToggleMobileNav()`, `onCloseMobileNav()`.
- `Topbar` renders a **hamburger** button (`aria-label="Open navigation"`, `aria-expanded`,
  `aria-controls` the sidebar) shown only `≤767px` (CSS, not JS). It calls `onToggleMobileNav`.
- `AppShell` renders a **backdrop** element when `mobileNavOpen`; clicking it → `onCloseMobileNav`.
- `Sidebar` gets `data-mobileopen`; tapping a nav item or an agent also closes the drawer on mobile
  (host closes via `onNavigate` → `onCloseMobileNav`).
- `AppLayout` (apps/web) owns `const [mobileNavOpen, setMobileNavOpen] = useState(false)`, closes it on
  route change (`useEffect` on `pathname`), and locks body scroll while open.

**CSS (`packages/ui/src/styles.css`, one `@media (max-width: 767px)` block):**
- `.gx-shell { grid-template-columns: 1fr; }` (single column).
- `.gx-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 60; width: min(84vw, 300px);
  transform: translateX(-100%); transition: transform .22s ease; }` — and ignore the desktop
  `[data-collapsed='true']` width shrink on mobile (the drawer is always full-content when open).
- `.gx-shell[data-mobileopen='true'] .gx-sidebar { transform: none; }`.
- `.gx-backdrop { position: fixed; inset: 0; z-index: 55; background: rgba(3,8,20,.55); }` (only when open).
- `.gx-shell__content { padding: 16px; }`; hide the desktop `.gx-sidebar__collapse` control on mobile.
- Respect `prefers-reduced-motion` (no slide transition).

**a11y:** `Esc` closes; focus moves into the drawer on open and back to the hamburger on close; the
hamburger toggles `aria-expanded`; the backdrop is not a focus trap escape.

## Phase 2 — per-screen reflow (`apps/web/src/index.css` + screens)

One `@media (max-width: 767px)` (and tablet where needed) block per screen area; **collapse multi-column
grids to a single column, make cards full-width, and wrap any wide table/diagram in `overflow-x: auto`**:
- **Dashboard (AgentRoom):** `.gx-room__kpis` → 1 col; `.gx-room__grid` (agents) → `minmax` that yields
  1–2 cols; heads/actions wrap.
- **Chat:** two-pane → single pane; the session rail becomes a **drawer/toggle** ("Conversations" button;
  slide-in panel + backdrop, mirroring the shell). Composer full-width. **SSE/streaming code untouched.**
- **Test Lab:** authoring forms + lists stack; summary stats wrap; any results table `overflow-x: auto`.
- **Billing / Integrations / Knowledge / Reports:** multi-col card grids → 1 col; usage meters + panels
  full-width; invoice/any tabular content scrolls horizontally inside its own container.
- **Topbar:** the search field collapses to an icon (or hides) `≤767px`; project/user controls compact so
  the row + hamburger fit without overflow.

## Verification / DoD

- **Per-view Playwright screenshots** at 390×844 (+ 768 spot-checks), before/after, `Read` each PNG.
- **Hard invariant:** no horizontal scroll at 390px on any authenticated screen
  (`document.scrollingElement.scrollWidth <= clientWidth`), asserted in a mobile-viewport Playwright smoke.
- **Drawer behavior** unit-tested on `AppShell` (hamburger toggles `data-mobileopen`; backdrop closes;
  nav-tap closes; desktop `collapsed` path unchanged).
- **Zero desktop regression:** the existing Playwright suite (desktop viewport) stays 18/18.
- Gates: typecheck · lint · Docker-free (≥ current 1122) · `test:int` 40 · BDD 209/1779 · Playwright
  (desktop 18 + the new mobile smoke).

## Out of scope (this pass)

Pre-auth Login/Register helix hero responsiveness (separate phase) · native Expo app · any visual redesign
beyond making the existing design reflow · new features.
