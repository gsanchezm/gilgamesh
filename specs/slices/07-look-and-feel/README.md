# Slice 7 — Look & feel (design system + all views)

SDD spec for recreating the Gilgamesh visual direction (`design_handoff_gilgamesh/`) in the real
stack at high fidelity. This slice is **presentation-first**: it re-skins the existing functional
screens and adds the missing views, without changing API behavior.

## Source of truth
- `design_handoff_gilgamesh/README.md` — tokens, typography, agent/avatar anatomy, view inventory.
- `design_handoff_gilgamesh/capturas/*.png` — the per-view visual target (dark default; `05` light).
- `design_handoff_gilgamesh/prototipos/*.dc.html` — layout/copy/interactions (reference, not ported).

## Owner decisions (this slice)
1. **English-only.** Respect decisions-log §2 — **no i18n toggle**, no ES/EN selector. UI copy in
   English (matches the screenshots). The handoff's ES copy is reference only.
2. **All views, hi-fi, mock behind a seam.** Views without a backend yet (Orchestration, Chat+voice,
   Session replay, parts of Reports) are built to full fidelity against a **mock client** sharing the
   real client's shape, so wiring later = swapping the port implementation.
3. **SDD→BDD→TDD applies.** Spec (this doc) → `.feature` per view (verified via Playwright mapped 1:1
   to scenarios) → component tests (Vitest + Testing Library) → implementation. Primitives are TDD'd.
4. **Responsive + native-ready.** Responsive across breakpoints; framework-agnostic data (tokens,
   roster, types) stays in shared packages so a future `apps/mobile` can reuse it. No native app now.

## Stack (detected — no change)
React 19 · Vite 6 · react-router-dom 7 · Tailwind 3.4 + CSS-vars tokens (`@gilgamesh/ui`) · clients
injected as typed ports · `SessionProvider` (auth) + `ClientsProvider`. Tokens, `data-theme`, and the
three Google Fonts already match the handoff.

## Design tokens
Already in `packages/ui/src/styles.css` (dark default + light), identical to handoff §4.4. This slice
adds: radii vars (`--radius-control|card|panel|pill`), the keyframes `gxwave/gxin/gxblink/gxdash/
gxspin/gxbreathe`, and the agent-avatar classes.

## Agent avatar (handoff §5)
`AgentAvatar` primitive: family-colored frame (`border-radius:24%`) → inset portrait
(`inset:2.5px; border-radius:22%`, `god-<slot>.png`, cover/top) → status dot ringed in `--surface`.
Glyph-on-gradient fallback when no portrait. Sizes: nav 26×28, card 56×64, ref 72×80. Roster data
(slot/glyph/family/culture/tool) already lives in `@gilgamesh/domain`; portraits resolve via
`portraitFor(slot)`.

## View inventory
Re-skin (backend exists): Login, Onboarding, Dashboard (Agent room), Test Lab, Integrations,
Knowledge, Subscription. New: App shell (sidebar + topbar), Pricing, Orchestration, Reports, Chat,
Session replay. New views without a backend use the mock-client seam.

## Build order
tokens+keyframes → **AgentAvatar** → Theme provider/toggle → AppShell (sidebar+topbar) → Dashboard →
remaining re-skins → new views (Pricing, Reports, Orchestration, Chat, Session).

## Definition of done
- Every view matches its `capturas/` target in dark and light (theme toggle works).
- `.feature` per view green via Playwright; component tests green; existing ~340 unit/e2e + BDD stay
  green (no API regression).
- No new runtime dependencies; lint + typecheck clean.

## Status
- ✅ Phase 1 — tokens/keyframes, `AgentAvatar` (+ `portraitFor`), assets copied to
  `apps/web/public/assets/`. Spec authored.
- ✅ Phase 2 — `ThemeProvider` + toggle, stroke `icons`, `Badge`, `Sidebar`/`Topbar`/`AppShell`
  (presentational, in `@gilgamesh/ui`), wired via `AppLayout` (web) around the authenticated routes
  (layout route). `ComingSoonScreen` placeholders for Orchestration/Reports so the nav is complete.
- ✅ Phase 3 — Dashboard (Agent room) re-skin: `Card` + `AgentCard` primitives, KPI row (Agents
  awake / Runs today / Success rate / Scenarios), Agents legend, agent-card grid + "work together"
  card; CTAs wired (Go to canvas / Open / Chat) to ComingSoon routes. Real EN copy from the prototype.
- ✅ Phase 4 — Login hero re-skin: two-column layout, animated helix (`gxdash`) with orbiting
  tool/browser chips (`gxfloat`), circular brand mark, real EN copy (`Sign in` / hero / `Enter` CTA /
  Remember me / providers / Create account). Login logic + placeholders preserved; button renamed
  `Sign in`→`Enter` across unit + e2e specs. Verified in-browser (smoke green, visual dark/light).
- ⬜ Remaining views (Pricing, Onboarding re-skin, Reports, Orchestration, Chat, Session, +
  re-skins of Test Lab / Knowledge / Integrations / Subscription).
- ⬜ Playwright `.feature`-mapped scenarios per view.
