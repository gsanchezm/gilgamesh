# Programa paralelo v7 — design (2026-07-09)

Five NO-KEYSTONE follow-up slices, built in parallel `pnpm wt` worktrees (owner-approved 2026-07-09:
*set recomendado no-keystone*, *no keystone bump*, *prune merged branches* — done). Continues the
v4/v5/v6 cadence: parallel Docker-free build → adversarial self-review per subagent → orchestrator
integrates with **serialized** stack gates + sequential FF merges.

**Why these five:** every design capture is either shipped or blocked (Orchestration/Session/voice/
mobile all need the TOM kernel or external engines). So the remaining unblocked, no-keystone work is
deferred-debt closure + hardening + one clean product extension (Stripe portal-only).

## The five slices (disjoint in files → parallel-safe)

| # | Branch | Scope | Primary files | Local gate |
|---|--------|-------|---------------|-----------|
| 34 | `slice-34-stripe-portal` | Stripe **billing portal, portal-only**. Additive port method `createPortalSession(orgId): Promise<{ portalUrl }>` (NOT a keystone change — precedent `listInvoices`/`handleWebhook`/`embedAs`/`forOrg`). Mock returns a deterministic offline URL; Stripe adapter calls `stripe.billingPortal.sessions.create`. Route `POST /orgs/:id/billing/portal` (OWNER/ADMIN; non-member 404). "Manage billing" button in `BillingScreen`. Refund/proration programmatic APIs = deferred (Stripe's hosted portal handles proration/plan-change/payment-method/cancel natively). | app `ports/payment.ts` · `payment/mock-payment-provider.ts` · billing use-case · api Stripe adapter + billing controller + route · web `BillingScreen.tsx` | SDD→BDD→TDD |
| 35 | `slice-35-logging-cors` | Close the v6 structured-logging deferreds + the v5 CORS deferred: `bufferLogs: true` so Nest's pre-`useLogger` bootstrap lines route through the JSON logger in json mode (pretty mode → `app.flushLogs()`, zero change); implement `JsonLogger.fatal()` (currently absent, latent); `exposedHeaders: ['X-Request-Id']` on `enableCors` so the browser can read the correlation id cross-origin. | api `main.ts` · `common/json-logger.ts` (+`.test.ts`) · `config.ts` if needed | SDD→TDD (unit) |
| 36 | `slice-36-db-pool-proof` | Close the v6 gap: an integration test that **independently proves the pool params reach the Postgres engine** (e.g. assert `connection_limit` bounds live connections via `pg_stat_activity`, or read `current_setting`/effective pool behavior) — today `db-pool.int.test.ts` doesn't prove params land. Test-only; no source change expected. | api `test/integration/db-pool.int.test.ts` | test:int (serial) |
| 37 | `slice-37-web-async-states` | Adopt the slice-28 `Spinner`/`ErrorState`/`EmptyState` primitives in the **remaining** screens: Dashboard/AgentRoom, Test Lab, Chat (Billing/Integrations/Knowledge/Reports already adopted). Load/error/empty lifecycle ONLY (slice-33 locked rule) — **do not** perturb Chat's live SSE EventSource path. `packages/ui` + `apps/web/src/index.css` untouched (primitives are self-styled in `packages/ui/styles.css`). | web `AgentRoom`/`TestLab`/`Chat` screens (+ tests) | SDD→TDD (unit) + Playwright (serial) |
| 38 | `slice-38-ci-sha-pin` | Bloque-3 mechanical: pin the GitHub Actions in `ci.yml`/`codeql.yml`/`secret-scan.yml` to full commit SHAs (they mix `@v4` tags with SHAs today). Resolve each SHA via `gh api repos/<owner>/<repo>/git/ref/tags/vN` — never guess — and keep a trailing `# vX.Y.Z` comment so Dependabot still bumps the pinned action. | `.github/workflows/*.yml` | YAML validity + SHA correctness (runs on GitHub) |

**Collision audit:** 34=`BillingScreen` vs 37=other screens (no overlap); 35=`main.ts`/`json-logger` vs
36=`test/integration`; 38=CI only. `packages/application/src/index.ts` (34) and `config.ts` (35/36) are
low-risk shared touch-points absorbed by the sequential FF-merge + rebase.

## Execution model (Tier-0 constraint is load-bearing)

`pnpm wt` worktrees have their own `node_modules` but **share Postgres/Redis/dev ports** (Tier-0). So:

- **Parallel phase (5 subagents):** each builds its slice SDD→BDD→TDD and verifies **Docker-free ONLY**
  — `pnpm -r typecheck` + `pnpm lint` + `pnpm -r test`. Each **writes** its `.feature`/steps/int tests
  but **MUST NOT run** `test:int`/`test:bdd`/`test:e2e` (Playwright) — concurrent runs truncate each
  other's shared tables and silently corrupt results. The orchestrator runs those serially.
- **Integration phase (orchestrator, serial):** per slice — adversarial code review → apply fixes →
  run the **full stack gate for that slice** (`test:int` + `test:bdd` + Playwright as applicable)
  BEFORE declaring it done → FF-merge to `main` → re-run the integrated gate. A fix round per api/web
  slice is expected (subagents hand back BDD/e2e unverified; the v6 EmptyState-copy regression is this
  exact class — unit-green ≠ e2e-green).

Merge order: leaves first (38 CI, 36 test-only), then 35 (api), then 34 (api+web), then 37 (web) — or
adjust by readiness. Apply any new Prisma migration to the shared dev DB before its serial gate; run
`prisma generate` in the main checkout after merging a schema-changing branch (none expected this round).

## Definition of done (per the board)

typecheck · lint · Docker-free suite green (currently 1095) · `test:int` (currently 39) · BDD
(currently 203/1734) · Playwright (currently 18) — each ≥ current, all green — then update
`CLAUDE.md` + `feature-status.md` + memory.
