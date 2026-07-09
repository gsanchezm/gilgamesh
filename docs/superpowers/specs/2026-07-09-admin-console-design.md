# Admin console — design & orchestration (2026-07-09)

Implement the **Gilgamesh administration console** from the design handoff, in the existing web stack.

## Source of truth (READ THESE — they hold the pixel-level detail)
- `design_handoff_gilgamesh/README.md` — visual system: design tokens, the **light/dark CSS vars**
  (`data-theme`), typography (Marcellus / IBM Plex Sans / IBM Plex Mono), radii, keyframes, discipline colors.
- `design_handoff_gilgamesh/README-admin.md` — the admin spec: two roles, the shell (§2), routes (§3),
  every view (§4 platform, §5 workspace), main state (§6), **the typed data shapes (§7)**, interactions (§8),
  and the capture map (§9).
- Visual targets (hi-fi, pixel-faithful): `design_handoff_gilgamesh/capturas/15-…` … `22-…`.
- **Do NOT port the `.dc.html` runtime** — take layout, tokens, copy, interactions; rebuild with our components.

## Non-negotiables (from the goal)
1. Routes `/admin/*` (platform role) and `/w/:wsId/admin/*` (workspace role), behind a **role guard** seam.
2. Light/dark theme using the README CSS vars (reuse the app's existing `data-theme` ThemeProvider).
3. **i18n es/en** (the main app is English-only and has NO i18n — the admin introduces its own scoped
   `T(lang, key)` + `lang` state). All copy exists in both languages.
4. Typed **mock data** matching the §7 shapes, behind a **service interface** (`AdminService`) so a real API
   drops in later. The workspace role **never sees internal Gilgamesh costs** (cost columns/cards/margins are
   platform-only — enforce in the service and the views).
5. No emoji; stroke SVG icons; numbers/folios in IBM Plex Mono.

## Stack & placement (reuse existing patterns)
- Lives in `apps/web/src/admin/` (React + Vite + React Router 7, same as the app). Routes added to
  `apps/web/src/app/AppRoutes.tsx`. Theme reuses the existing provider (`data-theme` on root). One dedicated
  stylesheet `apps/web/src/admin/admin.css` (imported by the admin layout) — **NOT** `index.css` (keep it isolated).
- The role is a **demo switch** in the sidebar (§1: production derives it from permissions; the switch
  demonstrates both experiences). The `RoleGuard` is a seam that permits for now and is where real
  staff/owner permission-derivation plugs in later. Switching role navigates to `/admin` or `/w/:wsId/admin`.

## File architecture (designed so Phase 2 views parallelize with ZERO shared-file edits)
```
apps/web/src/admin/
  admin.css                      # layout + SHARED primitives (.gx-adm*: card, kpi, table, chip, bar,
                                 #   hero, section-eyebrow, toast, sidebar, topbar). Read-only in Phase 2.
  data/types.ts                  # the §7 shapes (Cliente, Proyecto, Factura, Ejecucion, Incidente,
                                 #   Auditoria, TokensAgente, Pool, PlanPricing) + KPI/view view-models.
  data/mock.ts                   # ALL mock data enumerated in §4/§5 (complete). Read-only in Phase 2.
  service/admin-service.ts       # AdminService interface (platform + workspace methods; workspace methods
                                 #   return cost-stripped view-models) + MockAdminService. Read-only in Phase 2.
  i18n/index.ts                  # T(lang,key) + registry that merges the per-view dict modules below.
  i18n/<view>.ts                 # one dict module per view (es/en). Phase 2 fills its own; index pre-registers all.
  AdminContext.tsx               # provider: role, wsId, lang, theme(via app), period, toast, selClient/selProject.
  shell/{AdminLayout,AdminSidebar,AdminTopbar,Toast}.tsx
  RoleGuard.tsx
  routes.tsx                     # both role route trees, importing the view files below (lazy or direct).
  views/platform/{Resumen,Ingresos,Clientes,ClienteDetalle,Planes,Proyectos,ProyectoDetalle,Uso,Salud,
                  Usuarios,Auditoria}.tsx  (+ optional co-located <view>.css)
  views/workspace/{Resumen,Proyectos,Uso,Usuarios,Facturacion,Ajustes}.tsx  (+ optional <view>.css)
```
**Seam rule:** Phase 1 delivers complete `data/mock.ts`, `service`, `admin.css` primitives, `i18n/index.ts`
registry, the shell, `routes.tsx`, and a **stub component file for every view** (so routes resolve). Phase 2
groups then only EDIT their own view files + their own `i18n/<view>.ts` modules + their own optional
`<view>.css` — no shared file is touched, so parallel worktrees can't entangle.

## Phasing (orchestration)
- **Phase 1 — foundation + shell + Resumen (platform):** one cohesive subagent. Delivers everything under the
  seam rule above + the platform **Resumen** view fully (`capturas/15`) as the exemplar that proves the
  foundation (KPIs, MRR 12-month bars, MRR movement, top clients, collections, health mini, recent activity).
  Verify with Playwright screenshots at `/admin` in **dark AND light**. Merge to `feat-admin-console`.
- **Phase 2 — the rest, parallel subagents (worktrees off `feat-admin-console`):**
  - **Group A (platform · clients/projects):** Clientes (16) + ClienteDetalle (17) + Proyectos (19) + ProyectoDetalle.
  - **Group B (platform · money/ops):** Planes (18, live-margin editing) + Ingresos + Uso + Salud (20).
  - **Group C (platform · admin):** Usuarios + Auditoria.
  - **Group D (workspace role):** Resumen (21) + Proyectos/Uso/Usuarios (scoped, cost-stripped) + Facturacion + Ajustes (22).
  Each reads its captures + the spec sections, builds its view components against the ready service/i18n/
  primitives, and fills its own i18n modules. Orchestrator merges sequentially + adversarially reviews.

## Verification / DoD
- Per-view Playwright screenshots vs captures 15–22 (dark + a light spot-check); the workspace role shows NO
  cost columns/cards (assert). typecheck · lint · Docker-free web tests green · no horizontal overflow at the
  admin's min table widths (tables scroll inside their card). Then merge `feat-admin-console` → main.
- Real API, real permission-derived role guard, and wiring the admin into the app nav are explicit follow-ups.
