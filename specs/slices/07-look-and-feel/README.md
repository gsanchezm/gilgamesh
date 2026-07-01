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
- ✅ Phase 5 — **Register ("Create account") screen** (`capturas/02-registro.png`): the auth signup,
  twin of Login (shared animated hero on the left, form on the right). Backend already exists
  (`POST /auth/register` → `RegisterUser`, auto-signs-in; no Org yet — the tenant is bootstrapped at
  onboarding). Scope (owner-approved, advisor-sharpened):
  - Extract a shared `AuthHero` (helix canvas + brand) from `LoginScreen`; Login stays byte-identical.
  - `RegisterScreen`: First / Middle / Last name, **Company**, Corporate email, Password + Confirm,
    gold `Create account →`, `View plans →`, `Already have an account? Sign in`. Client validation:
    required first/last/company/email, valid email, **password ≥ 12** (matches API `@MinLength(12)`),
    `password === confirm` (confirm is client-only).
  - `authClient.register()` mirrors the **login** client (`credentials:'include'`, **no** CSRF token —
    register establishes the session; the controller has no CsrfGuard).
  - Route `/register` (public; redirect to `/onboarding` when already authed). Wire Login
    `Create account` → `/register`, both screens' `View plans` → `/pricing` (Phase 6), Register
    `Sign in` → `/login`. **Company** is carried to `/onboarding` via router state (becomes the Org
    name there — fixes the current `orgName = projectName` shortcut; that wiring lands with the
    onboarding-wizard follow-on). Register does **not** create the Org (spec AC-AUTH-01).
  - Follow-on (separate commit, no capture): re-skin the project **onboarding wizard** (port the
    prototype's `isOnboarding` layout) and consume the carried company as `orgName`.
- ✅ Phase 6 — **Pricing (public marketing page)** (`capturas/03-pricing.png`): ports the capture's
  layout/visual language but renders the owner's **NEW 4-tier model** (Free/Starter/Growth/Scale,
  billed per active workspace/mo — supersedes the slice-4 TEAM/PRO/ENTERPRISE seat model). Canonical
  `PLAN_CATALOG` in `@gilgamesh/domain` (`pricing/plan-catalog.ts`, pure + TDD: monthly/annual = 10
  months so 2 free, per-month-equivalent display). `PricingScreen`: top bar, hero, MONTHLY/ANNUAL
  toggle, 4 cards (Growth = "Most popular", gold), "Everything in X, plus" prefaces, Scale
  per-extra-workspace add-on. Always dark (pre-auth). Route `/pricing` (public) → CTAs enter the
  funnel (start free → register; sign in → login). `pricing.feature` ↔ Playwright. **Deferred (its own
  slice):** migrate the billing/subscription **backend** + the `/billing` screen to the new model —
  scheduled to land with the **Subscription re-skin** (capture 12), its natural home.
- ✅ Phase 7 — **Knowledge base re-skin + per-org document upload** (`capturas/09-base-de-conocimiento.png`).
  The capture is an UPLOAD/ingest view (not the existing global search), so this adds a **new per-org
  capability** (owner-approved: real .md/.txt ingest + a "+ demo" sample; PDF/.docx parsing deferred —
  no new deps): `KnowledgeDocument` (per-org) + `orgId`/`documentId` on `KnowledgeChunk` (migration
  `knowledge_per_org_documents`); `chunkText` (domain, pure); `UploadKnowledgeDocument`/
  `ListKnowledgeDocuments` (RBAC: non-member → NOT_FOUND); the shared `search`/`count` filter
  `orgId IS NULL` so uploaded chunks **never leak** into the global search; `POST|GET
  /orgs/:orgId/knowledge/documents` in both wirings. Web: `KnowledgeScreen` re-skin (drag/click upload
  zone + "+ demo" + "Indexed documents" list) **keeping** the shared search. Verified: domain 71 ·
  application 142 · web 83 · api 85 Docker-free · knowledge int 4 (pgvector) · Playwright knowledge.
  **Follow-up:** wire per-org retrieval into grounding; PDF/.docx parsing (needs deps).
- ⬜ Remaining views (Reports, Orchestration, Chat, Session, + re-skins of Test Lab / Integrations /
  Subscription — Subscription re-skin also migrates billing to the new pricing model).
- ⬜ Playwright `.feature`-mapped scenarios per view.
