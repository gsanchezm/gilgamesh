# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Gilgamesh** — a multi-tenant web+mobile QA platform where 11 AI agents (each a mythological deity)
plan, author and run software tests, collaborate on a DAG orchestration canvas, and keep all results
in-app. Dark mode by default, English-only (no i18n). Execution runtime = the owner's TOM microkernel +
Atomic-Helix-Model (consumed as a dependency; real test execution from day 1, behind the `TestKernel` port).

Design source of truth: Claude Design project `ad397295-…` (read via the DesignSync MCP). The canonical
extract is `docs/research/gilgamesh-prototype-extract.md`; locked decisions are in
`docs/research/decisions-log.md`; the frozen contract vocabulary is `specs/_keystone/foundation-vocabulary.md`.

## Methodology (non-negotiable)

Every vertical slice is driven **SDD → BDD → TDD**: spec in `/specs` → Gherkin `.feature` → failing unit
tests → green → refactor. Clean Architecture with ports & adapters; dependencies point inward only
(domain has zero framework imports). Performance and security are first-class (per-`orgId` tenant
isolation on every query, secrets as vault refs, OWASP ASVS L2 target). Favor small, reviewable increments.

## Commands

```bash
pnpm install                                   # bootstrap the workspace (pnpm + Turborepo)
pnpm -r test                                   # all unit/e2e tests across packages (Vitest)
pnpm -r typecheck                              # type-check every package
pnpm --filter @gilgamesh/<pkg> test            # one package, e.g. @gilgamesh/domain | application | ui | web | api
pnpm --filter @gilgamesh/api test -- <file>    # a single test file (Vitest filter)
pnpm --filter @gilgamesh/web dev               # Vite dev server (web)
docker compose up -d postgres redis            # local Postgres 16 + pgvector AND Redis (needs Docker Desktop)
pnpm --filter @gilgamesh/api prisma:migrate    # apply Prisma migrations to the DB
pnpm --filter @gilgamesh/api test:int          # integration tests against real Postgres + Redis
pnpm --filter @gilgamesh/api test:bdd          # Cucumber-js BDD acceptance vs API+Postgres (182 scenarios)
pnpm --filter @gilgamesh/web test:e2e          # Playwright browser smoke vs the running web+api+db stack
```

If a fresh Docker Desktop install isn't on the shell PATH yet, invoke it by full path and add its bin dir
(for the credential helper): `& "C:\Program Files\Docker\Docker\resources\bin\docker.exe"` with
`$env:PATH = "C:\Program Files\Docker\Docker\resources\bin;" + $env:PATH` (PowerShell). Prisma connects to
`localhost:5432` regardless of which shell started the container.

Notes:
- pnpm 11 blocks dependency build scripts by default; approved ones live under `allowBuilds:` in
  `pnpm-workspace.yaml` (currently `esbuild`, `@swc/core`). Add new native builders there.
- The API (`apps/api`, NestJS) tests run under Vitest via **unplugin-swc** (decorator metadata) — see
  `apps/api/.swcrc` and `apps/api/vitest.config.ts`. It is `type: commonjs`; the rest of the repo is ESM.

## Architecture / layout

```
packages/domain        — entities, value objects, the 11-agent roster, pure logic. No framework imports.
packages/application   — use cases + PORT interfaces (repositories, PasswordHasher, IdGenerator, Clock,
                         TokenGenerator) + in-memory repository adapters (temporary persistence + test doubles).
packages/ui            — React design-system components (tokens dark/light, Button, StatusDot, AgentTile).
apps/web (Vite+React)  — screens (Login, Onboarding, AgentRoom) wired by React Router (login→onboarding→
                         agent room) with session + injectable-clients providers; screens use typed client ports.
apps/api (NestJS)      — controllers (auth, projects, agents) + SessionAuthGuard + ValidationPipe +
                         DomainExceptionFilter; infra adapters (Argon2id, UUID v7, crypto session token).
```

Key seams:
- **Use cases never touch frameworks.** Controllers/repos are adapters that wire ports to implementations
  in `apps/api/src/persistence/persistence.module.ts` (DI tokens in `persistence/tokens.ts`).
- **Two persistence wirings, same ports:** in-memory (`PersistenceModule`, used by the default Docker-free
  tests) and **Prisma/Postgres** (`PrismaPersistenceModule` + `apps/api/src/persistence/prisma/*`, used by
  `test:int` and production). UI, controllers and use cases are identical across both — only the bound adapters differ.
- **Tenant isolation + authz live in the use cases** (`requireProjectAccess`): a non-member gets `NOT_FOUND`
  (never 403) so project existence is not leaked across tenants.
- Cross-package imports resolve to source via tsconfig `paths` + Vitest `resolve.alias` (no build step for
  dev/test). Production builds use `tsup`/`vite`/Nest.

## Slice 1 status (Auth + Onboarding + Agent room) — DoD COMPLETE

Built and green (~128 Docker-free unit/e2e tests): domain, application (all use cases + the authz gate and
org-queries now directly tested), ui, web (3 screens + React Router flow login→onboarding→agent room), the
full API surface (`/auth/{register,login,me,logout}`, `POST /projects`, `GET|PATCH /projects/:id/agents`,
`POST .../wake-all`, `GET /orgs/:id/{agents,subscription}`) with session guard, CSRF double-submit,
**auth rate-limiting**, validation, RFC9457 error mapping, real Argon2id, AND **Prisma persistence against
real Postgres** (schema + migration in `apps/api/prisma/`, Prisma adapters). The default
`pnpm --filter @gilgamesh/api test` stays in-memory (Docker-free); `*.int.test.ts` runs only via `test:int`.

All Definition-of-Done blockers are met and verified green:
- **BDD acceptance** — `pnpm --filter @gilgamesh/api test:bdd` (Cucumber-js over `specs/slices/01-*/*.feature`
  against API+Postgres): **49 scenarios / 384 steps**.
- **Integration** — `pnpm --filter @gilgamesh/api test:int` (real Postgres **+ Redis**): 9 tests, incl. the
  Redis rate-limit store and transactional onboarding rollback.
- **Playwright e2e** — `pnpm --filter @gilgamesh/web test:e2e`: a browser smoke (login → onboarding → agent
  room toggle + wake-all) against `main.ts` (ProdAppModule) behind the vite same-origin proxy; the only layer
  that exercises real Secure/`__Host-`/SameSite cookie semantics + the client CSRF double-submit.
- **Production bootstrap** — `main.ts` → `ProdAppModule` (`PrismaPersistenceModule`, `/api/v1`, helmet, CORS
  allowlist, `trust proxy`, shutdown hooks).
- **Rate limit (AC-AUTH-13)** — fixed-window behind a `RateLimitStore` port: in-memory (Docker-free) and
  **Redis** with native TTL (prod, selected by `REDIS_URL`). `docker-compose.yml` now runs Postgres **+ Redis**.
- **Web session** — `GET /auth/me` restore on load (the SPA can't read the httpOnly cookie) + client CSRF
  double-submit on every mutation; `logout()` client method in place.

**Deferred (owner decision S1-B, see `docs/research/decisions-log.md`) — ALL CLOSED:** forgot/reset-password +
EmailPort (closed by slice 12); disabled Google/SSO login controls (AC-AUTH-15, closed by slice 15); the
logout UI control (shipped by the slice-7 shell; verified + covered by slice 18). **CI/quality gates wired + green** (`.github/workflows/`): `ci.yml` (ESLint
boundaries + react-hooks · typecheck · Docker-free tests · integration + BDD on Postgres/Redis · Playwright) ·
`codeql.yml` (SAST, 0 alerts) · `secret-scan.yml` (gitleaks) · `dependabot.yml`. Plus `domain`/`application`
architecture fitness tests. **Remaining gates (follow-up):** bundle-size, k6 perf, contract tests.

## Slice 2 status (Test Lab authoring) — DoD COMPLETE

`specs/slices/02-test-lab-authoring/` — authoring of `Slice` + `Feature` (Gherkin parsed into `Scenario`) +
`TestCase`, plus AI `generate` behind a **deterministic stub** `AgentBrainPort` (the real Claude adapter is a
later Brain slice; owner decision S2-A/B). No execution; no bulk import. Built SDD→BDD→TDD across all layers,
green end-to-end on branch `slice-2-test-lab-authoring`:
- **domain** — `parseFeature` Gherkin parser (pure, `packages/domain/src/testlab/`).
- **application** — 15 use cases (Slice/Feature/TestCase CRUD + GenerateDrafts), 4 new ports
  (Feature/Scenario/TestCase repos + the §5 `AgentBrainPort`), `DeterministicBrain` stub, in-memory adapters.
- **api** — controllers + DTOs + `TestLabModule` on the keystone §6 paths; both persistence wirings (Prisma
  models `Feature`/`Scenario`/`TestCase` + migration + adapters); `generate` joins `RateLimitGuard`.
- **web** — `TestLabClient` + `TestLabScreen` at `/projects/:id/lab` (CSRF on mutations).
- **Verified:** typecheck clean · ~182 Docker-free unit/e2e · `test:int` 9 (Postgres + Redis) · **BDD 69
  scenarios / 539 steps** (`specs/slices/*/*.feature`) · **Playwright** smoke + Test Lab e2e.

`docker-compose.yml` runs Postgres + Redis; the BDD harness (`apps/api/acceptance`) and the Playwright config
(`apps/web/playwright.config.ts`) both boot the real stack.

## Slice 3 status (Test Execution + Results) — DoD COMPLETE

`specs/slices/03-test-execution/` — run an authored `Feature` (its `Scenario`s) or `TestCase` behind the
keystone **`TestKernel`** port and see **results** in-app. Owner decision S3: the port is wired to a
**deterministic stub** `DeterministicKernel` (the Brain-stub pattern of slice 2) as a **synchronous núcleo** —
the real `chaos-proxy`/TOM adapter + SSE streaming + DAG + workers are the Orchestration slice (keystone §7
`BLOCKED-UNTIL-DELIVERED`). Built SDD→BDD→TDD across all layers, green end-to-end on branch
`slice-3-test-execution`:
- **domain** — `summarizeRun` (pure result aggregation → terminal `RunStatus` + counts + `ratePct`).
- **application** — `TestKernel` port + `DeterministicKernel` stub (offline, streams `RunEvent`s); `Run`/
  `RunResult` records + repos (added to the `UnitOfWork` bundle); `TriggerRun`/`ListRuns`/`GetRun` (UoW-atomic
  run + results + `Scenario.lastStatus`/`TestCase.status` reflection); in-memory adapters.
- **api** — `RunsModule` (`POST /projects/:id/runs`, `GET /projects/:id/runs`, `GET /runs/:id`); Prisma `Run`/
  `RunResult` models/enums + migration + adapters in **both** UoW wirings; `DeterministicKernel` bound to the
  `TestKernel` token.
- **web** — `RunsClient` + a "Run" button per feature/test-case in `TestLabScreen` + an aggregated results
  panel (CSRF on the trigger).
- **Verified:** typecheck clean · ~216 Docker-free unit/e2e · `test:int` 10 · **BDD 75 scenarios / 592 steps** ·
  **Playwright** smoke + Test Lab + run flow.

## Slice 4 status (Subscription & Billing) — DoD COMPLETE

`specs/slices/04-subscription-billing/` — manage `plan`/`seats`/`billingCycle`, **mock checkout**, and
**cancel**, behind the keystone **`PaymentProvider`** port wired to a deterministic `MockPaymentProvider` stub
(owner decision S4; real Stripe + `Invoice`/webhooks deferred). Also **closes the slice-3 deferred follow-up**:
enforces `runMinutesQuota` on `TriggerRun`. Built SDD→BDD→TDD across all layers, green on branch
`slice-4-subscription-billing`:
- **domain** — `planLimits` + `priceCents` (keystone §9 pricing; pure).
- **application** — `PaymentProvider` port + `MockPaymentProvider`; `ChangeSubscription`/`UpdateSeats`/
  `StartCheckout`/`ConfirmCheckout`/`CancelSubscription` (OWNER/ADMIN; member view; non-member NOT_FOUND);
  extended `SubscriptionView`; `TriggerRun` charges run-minutes + blocks with `QUOTA_EXCEEDED` (atomic).
- **api** — `BillingModule` (`PATCH /orgs/:id/subscription`, `/seats`, `POST .../checkout[/confirm]`,
  `/cancel`); `MockPaymentProvider` bound in both wirings; `PrismaSubscriptionRepository.save`;
  `QUOTA_EXCEEDED`→402. No migration (the `Subscription` model exists since slice 1).
- **web** — `BillingClient` + `BillingScreen` at `/billing` (plan + usage meter, change-plan/seats, checkout,
  cancel; CSRF on mutations).
- **Verified:** typecheck + lint clean · ~281 Docker-free unit/e2e · `test:int` 10 · **BDD 82 scenarios / 648
  steps** · **Playwright** smoke + Test Lab + run + billing.

## Slice 5 status (Knowledge / RAG) — DoD COMPLETE

`specs/slices/05-knowledge-rag/` — ingest the `rag/` QA corpus (full ISTQB syllabi + BDD books, pre-chunked
into `rag/chunks/chunks.jsonl`, ~2,647 chunks) as a **GLOBAL shared** knowledge base (no `orgId`, owner
decision S5-A — the one place tenant isolation is deliberately relaxed) that **grounds generation** for all
orgs. Built SDD→BDD→TDD across all layers, green on branch `slice-5-knowledge-rag`:
- **domain** — `scrubChunk` (strips PDF page-furniture + the ISTQB copyright line), `embedText` (deterministic
  FNV-1a lexical-hash → 1536-dim L2-normalized; real lexical, not semantic — real embeddings land with the
  Brain slice, S5-B), `cosineSimilarity` (pure).
- **application** — `KnowledgeChunkRepository` + `KnowledgeRetrievalPort`; `IngestKnowledge` (scrub → drop
  near-empty → embed → upsert), `SearchKnowledge` (embed query → cosine top-k + citations), `KnowledgeRetriever`;
  `GenerateDrafts` now consults the retrieval port and attaches **source citations** to drafts (S5-C/D);
  `DeterministicBrain.embed` returns lexical-hash vectors; in-memory cosine adapter.
- **api** — Prisma `KnowledgeChunk` with `Unsupported("vector(1536)")` + migration (`CREATE EXTENSION vector`);
  `PrismaKnowledgeChunkRepository` (raw-SQL upsert `::vector` + `<=>` cosine search, count via typed client);
  both wirings bind `Knowledge` + `KnowledgeRetrieval`; `KnowledgeModule` (`GET /knowledge/search`, authed,
  org-agnostic) + a `KnowledgeSeeder` (paraphrased `SAMPLE_CHUNKS` at startup if empty);
  `scripts/ingest-corpus.mjs` (`pnpm --filter @gilgamesh/api ingest:corpus`) loads the full corpus.
- **web** — `KnowledgeClient` + `KnowledgeScreen` at `/knowledge` (search → ranked snippets + source citations).
- **Licensing (S5-D):** retrieval-grounding only; citations always carry source+section; the store is
  private/non-redistributable; no verbatim re-publication without attribution.
- **Verified:** typecheck + lint clean · ~304 Docker-free unit/e2e (domain 48 · application 120 · api 72 ·
  web 55 · ui 9) · `test:int` 12 (pgvector against real Postgres) · **BDD 88 scenarios / 694 steps** ·
  **Playwright** smoke + Test Lab + run + billing + knowledge.

## Slice 6 status (Integrations) — DoD COMPLETE

`specs/slices/06-integrations/` — connect a **SOURCE_REPOS** integration (`github, gitlab, bitbucket,
ado_repos`) behind a deterministic `MockRepoProvider` + a `StubSecretVault` (owner decision S6-A; the raw
token is verified then **discarded** — only a synthetic `secretRef` is stored, never the token), and **import
`.feature` files** from a connected repo into the Test Lab. Built SDD→BDD→TDD across all layers, green on
branch `slice-6-integrations`:
- **domain** — `SOURCE_REPO_CATALOG` (keystone §8 keys) + `repoProviderForKey` (`ado_repos`→`ado`; the
  `Integration.key` and `Project.repoProvider` enums differ).
- **application** — `Integration` record (per-org; `secretRef`, never a token) + `RepoProvider`/`SecretVault`/
  `IntegrationRepository` ports; `ListIntegrations` (catalog ⨝ connected rows), `ConnectIntegration`
  (verify → `vault.put` → upsert; audits **without** the token), `DisconnectIntegration`, `ImportRepoFeatures`
  (resolve the integration by `project.orgId`, pull `.feature` files, **upsert Features by path** = idempotent
  re-import, link the project incl. `repoLastSyncAt`; UoW-atomic). `ProjectRecord` gains `repoLastSyncAt` +
  `ProjectRepository.save`.
- **api** — Prisma `Integration` model + `IntegrationGroup` enum + migration (`projects.repo_last_sync_at`);
  `PrismaIntegrationRepository` + both wirings bind `Integrations`/`RepoProvider`/`SecretVault`;
  `IntegrationsModule`: `GET /orgs/:orgId/integrations` + the single keystone mutator
  `PATCH /orgs/:orgId/integrations/:key` (action in the body) + **[S6-NEW]** `POST /projects/:id/repo/import`.
- **web** — `IntegrationsClient` + `IntegrationsScreen` at `/integrations` (catalog connect/disconnect);
  Test Lab gains an "Import from repo" control.
- **Security (S6-B):** the raw token never appears in any View, list, audit metadata, or DB row (verified by
  a BDD assertion); OWNER/ADMIN gate; per-`orgId` isolation.
- **Verified:** typecheck + lint clean · ~340 Docker-free unit/e2e (domain 54 · application 134 · api 80 ·
  web 63 · ui 9) · `test:int` 14 · **BDD 94 scenarios / 738 steps** · **Playwright** smoke + Test Lab + run +
  billing + knowledge + integrations.

## Slice 7 status (Look & feel) — IN PROGRESS (branch `feat/look-and-feel`)

`specs/slices/07-look-and-feel/` — recreate the whole design (`design_handoff_gilgamesh/capturas/`) at
~100% fidelity, **UI + real functionality in parallel** (stub-behind-a-seam only where a backend is blocked),
English-only, pre-auth screens always-dark, responsive + native-ready. Review cadence = per-view screenshot.
**Product board: `docs/research/feature-status.md`.**
- **Done (committed):** Ph1 tokens/keyframes + `AgentAvatar` + assets · Ph2 `ThemeProvider`+toggle +
  `Sidebar`/`Topbar`/`AppShell` (in `@gilgamesh/ui`) · Ph3 Dashboard (Agent room) re-skin · Ph4 Login hero
  (canvas **port** of the prototype's rAF DNA-helix) · Ph5 Register + shared `AuthHero` · Ph6 Pricing (renders
  the **new 4-tier `PLAN_CATALOG`** in domain; billing-backend migration deferred) · Ph7 Knowledge re-skin +
  **real per-org document upload** (`KnowledgeDocument` + `orgId`/`documentId` on chunks + migration; shared
  search filters `orgId IS NULL` = no cross-org leak; `.md`/`.txt` ingest).
- **Next:** Test Lab re-skin (capture 10, backend exists) → Integrations (11) → Subscription (12, + billing →
  new 4-tier model migration) → heavy new views.
- **Blocked / deferred views:** Orchestration (real TOM kernel, keystone §7 `BLOCKED-UNTIL-DELIVERED`) · Chat+voice
  (real Brain/Claude) · Reports + Session (partially doable over slice-3 `Run`/`RunResult`). PDF/.docx ingest &
  per-org RAG grounding = follow-ups.

## Audit remediation status (2026-07-01)

Codebase-audit follow-up. Tracking: `docs/research/audit-followup.md` · board: `docs/research/feature-status.md`.
- **Batch A** — ✅ **merged + pushed to `main`** (auth DTO `@MaxLength` + `INPUT_LIMITS`, deterministic body
  limit + 413 filter fix, in-memory↔Prisma order parity, cookie-name centralization).
- **#1/#2/#6/#7/#10/R2** — ✅ done on `feat/look-and-feel` (owner decision: *ride look&feel* to main; `#10` is
  entangled with slice-7's per-org knowledge schema). Atomic knowledge upload (`UnitOfWork`, document-first) +
  chunk FKs/indexes; `ListFeatures` `countByFeature` (no N+1); TC-key retry-on-`CONFLICT` (Prisma `P2002`→`CONFLICT`);
  batch RAG `upsertMany` (`Prisma.join`); shared `apps/web/src/lib/http.ts`. Verified: 409 Docker-free · `test:int`
  19 · BDD 94 · typecheck · lint.
- **Bloque 3 (pending owner decision):** rate-limit fail-open policy · per-IP backoff (own slice) · pagination
  (own slice) · RAG final posture · optimize heavy assets · ~~pin GitHub Actions to SHA~~ (done, CI hardening).
- **Batch C (2026-07-06, auditoría v2 — merged+pushed `e82292c`):** #6 atomic single-use reset-token claim
  (`claimUnused` conditional WHERE `usedAt IS NULL` + the whole reset inside `UnitOfWork`; PasswordResets
  joined the UoW bundle) · #5 timing-safe forgot-password (equal token work both paths; email dispatch
  fire-and-forget, failures swallowed unlogged by design) · #2 `multer>=2.2.0` via `overrides:` in
  pnpm-workspace.yaml · #8 pgvector HNSW index (`knowledge_hnsw_index` migration) + ANN query shape
  (inner bare-distance `LIMIT k*4` + outer deterministic `(distance, id)` re-sort — a tie-break inside
  the inner ORDER BY would bypass the index) · #11 AuthHero rAF pauses on hidden tab / reduced motion ·
  #12 chat EventSource `withCredentials`. Verified: **815 Docker-free** · int 19 · BDD 182/1517 ·
  Playwright 18. Remaining from auditoría v2: ~~Vitest 3 toolchain~~ and ~~real secret vault (Key
  Vault)~~ — both CLOSED by programa v3 (2026-07-06 PM3, see below) · Bloque 3 (owner decision).

## Post-slice-7 — integrated on `main` (2026-07-01)

Slice 7 (look&feel) is **merged on `main`** (`b4c3c09`). Two parallel streams were then integrated (green:
typecheck · 440 unit tests · lint) and **pushed to `origin/main`**:
- **Reports (capture 08, read-only)** — `summarizeAcrossRuns` (pure domain fold of a project's runs into
  run-health counts + 1-decimal `ratePct` + `lastRunAt`) + `ReportsScreen` (`{runsClient, projectId}`,
  reuses the runs client/API; health card + stat cards + recent-runs list). **Route not wired yet**
  (`/projects/:id/reports`); the capture's per-tool "Tools" breakdown is deferred (slice-3 `RunResult`
  has no tool/discipline dimension). Spec: `docs/superpowers/specs/2026-07-01-reports-view-design.md`.
- **PDF/.docx knowledge parsers** — `packages/domain/src/knowledge/parse-document.ts` (+ Knowledge upload
  now accepts `.pdf`/`.docx`, not just `.md`/`.txt`).

**Preserved, NOT merged:** the **Onboarding wizard re-skin** (Company→`orgName`) is WIP on branch
`feature/onboarding-reskin` (`5ab3f59`) — **unverified**; finish + verify (SDD→BDD→TDD) before merging.

**Process lesson:** run each parallel stream in its own `pnpm wt` worktree — never share the main working
dir. Two streams here both appended to `apps/web/src/index.css`, which made scope-committing painful; the
fix was to extract each stream's work onto its own branch. (See auto-memory `gilgamesh-parallel-worktrees`.)

## Slice 8 status (Agent Chat, text) — DoD COMPLETE (2026-07-05, on `main`)

`specs/slices/08-agent-chat/` — chat with the pantheon behind the **deterministic stub brain** (owner
decision S8). The keystone was amended to **v0.2 first, in series on `main`** (`933769d`):
`ChatSession`/`ChatMessage` + `ChatMessageRole`/`KnowledgeScope` + `KnowledgeChunk.scope` (indexed) +
the 3 chat routes + a new §10 changelog. Built SDD→BDD→TDD (BDD red first: 18 scenarios failing on 404),
then hardened by an 8-angle adversarial review (7 findings fixed TDD) and merged FF (`a3b7284`):
- **domain** — `personaPrompt` (prose personas anchored `You are <deity>,` — the stub's dispatch prefix).
- **application** — `CreateChatSession`/`SendChatMessage`/`GetChatEvents`; router via
  `AgentBrainPort.complete()` at HAIKU (confidence < 0.6 → lead; `ToolBinding.enabled=false` excluded;
  pinned sessions skip classify); **scoped retrieval** (`searchScoped`/`retrieveScoped`: org-visible chunks
  where `scope` = slot | `shared` | NULL); **closed 3-tool whitelist** (`enqueue_run`/`create_test_case`/
  `generate_feature`) invoking the CANONICAL use cases (quota/RBAC/audit unchanged; args capped at the DTO
  limits; failures narrated in-chat; every attempt audited with outcome); `DeterministicBrain` chat branches
  dispatch on **caller intent** (system-prompt prefix), never on message/grounding content.
- **api** — `ChatModule` (`POST /projects/:id/chat` · `POST /chat/:sessionId/messages` [rate-limited,
  POST-only, suffix+IP bucket] · `GET /chat/:sessionId/events` = the repo's **first SSE surface**,
  deterministic replay-then-close); Prisma models + migration `agent_chat`; both persistence wirings.
- **web** — `ChatClient` + `ChatScreen` at `/projects/:id/chat` (lazy session, SSE-replay resync,
  run-narration blocks, `?agent=` pin; the tile-pinned entry lands with the Chat re-skin).
- **Verified (post-merge on `main`):** typecheck + lint · 504 Docker-free unit/e2e · `test:int` 19 ·
  **BDD 112 scenarios / 896 steps** · **Playwright 15** (incl. the chat e2e).
- **Deferred (review S8 / spec §13):** real answers + live SSE push (Brain slice) · reusable SSE adapter +
  first-class tool registry · session list/history routes (keystone amendment) · `FeatureRepository.findByName`
  · web appends the answer instead of full replay · `agent_id` FKs on chat tables.

## Slice 9 status (Brain — real `AgentBrainPort` adapter) — DoD COMPLETE (2026-07-06, on `main`)

`specs/slices/09-brain/` — the real Claude adapter behind the frozen port + BYOK + metering + live chat
SSE + tool registry (owner decisions S9-1..6). Keystone amended to **v0.3 first, in series on `main`**
(`214f94b`): `AI_PROVIDERS`/`anthropic` (§1/§8), `BrainSurface` (§1), `BrainUsage` (§2/§5),
`GET /orgs/{orgId}/brain/usage` (§6). Built SDD→BDD→TDD (BDD red first: 12 scenarios failing), hardened
by a 3-angle adversarial review (6 findings fixed; secrets/DI/conventions gates clean), merged FF:
- **domain** — `AI_PROVIDER_CATALOG` + `aggregateBrainUsage` (pure fold for the usage view).
- **application** — `ChatToolRegistry` (SINGLE source: Claude `tools` defs + arg validation + dispatch;
  `INVALID_ARGS` narrated + audited, the use case never runs); unconditional `BrainUsage` metering
  (ROUTER/CHAT in `SendChatMessage`, GENERATE in `GenerateDrafts`, cache tokens threaded through);
  brain-outage narration (a send never 500s); frozen §5 `EventBus` port + `InMemoryEventBus` with
  MESSAGE/DELTA/DONE publishing per session; `GetBrainUsage`; BYOK via `BrainKeyVerifier` merged into
  the S6 integration flow; `streamWithUsage` optional extension (usage for streamed calls).
- **api** — `ClaudeBrain` infra adapter (Messages API over fetch: tier→model env config, prompt caching
  via the frozen `cacheKey` incl. cache-token usage capture, 30s timeout + one drained retry, output cap;
  the key never reaches logs/errors/rows); `SelectingBrain` bound to `TOKENS.Brain` in both wirings
  (`BRAIN_MODE=offline` or no `ANTHROPIC_API_KEY` → stub; org-BYOK call-time resolution = follow-up
  pending `SecretVault.get()`); `AnthropicKeyVerifier` (1-token ping, auto mode only); `BrainModule`
  (usage route); Prisma `BrainUsage` + migration `brain_usage`; **C3 live SSE** (explicit `?live=1`
  opt-in, subscribe-before-replay with deduped flush, guarded writes, leak-proof teardown, heartbeat).
- **web** — Billing gains the **AI usage** card (`getBrainUsage`); Integrations renders AI Providers;
  ChatScreen keeps replay resync (live EventSource = Chat re-skin follow-up).
- **Verified (post-merge on `main`):** typecheck + lint · 570 Docker-free unit/e2e · `test:int` 19 ·
  **BDD 133 scenarios / 1063 steps** · **Playwright 17**. Every suite runs offline (`BRAIN_MODE=offline`
  in all four harnesses + test-setup default); real answers require only `ANTHROPIC_API_KEY` at runtime.
- **Deferred:** ~~org-BYOK call-time key resolution~~ (CLOSED on `main` via `feat-byok-live`:
  `SecretVault.get()` + the `forOrg(orgId)` optional extension — per-call row re-read, orgId+secretRef
  cache, offline seam preserved) · live EventSource in the web
  chat · semantic embeddings (Anthropic has no embeddings API — Voyage decision) · token charging
  (4-tier billing migration) · optional `BRAIN_SMOKE` manual live-key smoke.


## Slice 12 status (Auth recovery) — DoD COMPLETE (2026-07-06, on `main`)

`specs/slices/12-auth-recovery/` — forgot/reset password behind the frozen keystone v0.4 vocabulary
(`PasswordReset` entity, `EmailPort` stub that records mail in-memory, long-frozen §6 routes). Closes
owner decision S1-B. Built SDD→BDD→TDD (8 scenarios red on 404s first): enumeration-safe generic 202,
256-bit CSPRNG token stored sha256-only (TTL 30 min, single-use `usedAt` claimed BEFORE the password
rewrite; weak passwords never consume the token), reset revokes every session, audits without secrets.
Prisma migration `password_reset`; both wirings bind `PasswordResets`/`Email`; Forgot/Reset screens +
public routes wired from Login. **Verified (post-merge):** typecheck + lint · 623 Docker-free ·
`test:int` 19 · **BDD 141 scenarios / 1141 steps** · Playwright 17. Deferred: real SMTP/SES adapter ·
the @wip rate-limit outline (AC-AUTH-13 pattern).


## Slice 10 status (Billing 4-tier formalization) — DoD COMPLETE (2026-07-06, on `main`)

`specs/slices/10-billing-4tier/` — formalizes the 4-tier workspace pricing that shipped functionally in
`7632020`: SDD spec (owner decision S10 field mapping: `seats` = active workspaces, `runMinutes*` =
executions — NO keystone change) + 7 BDD scenarios (AC-B4T-01..06: catalog remap, FREE workspace cap,
SCALE $499 + $99/extra ws asserted on the API price, annual = 10 months, quota-blocks-runs regression).
Domain `planLimits`/`priceCents` now DERIVE from `PLAN_CATALOG` (single source, no duplicated numbers —
the real TDD red); exact price pins in application/api tests; BillingScreen's SCALE add-on line derives
from the catalog. **Verified (post-merge):** typecheck + lint · 633 Docker-free · `test:int` 19 ·
**BDD 148 scenarios / 1223 steps** · Playwright 17. Deferred: Stripe/Invoice/webhooks · storage-column
rename to execution semantics (future keystone major) · Brain token charging hookup.


## Slice 11 status (Chat re-skin, capture 07) — DoD COMPLETE (2026-07-06, on `main`, owner-approved visual)

`specs/slices/11-chat-reskin/` — the capture-07 chat experience over keystone v0.4's read routes.
Application/api: `ChatSessionRepository.listForProject` (updatedAt desc) + batched
`firstUserMessageBySession` (no N+1) + `ListChatSessions` (derived 60-char `title`, MEMBER+);
history = the existing `GetChatEvents` behind `GET /chat/{sessionId}/messages`;
`GET /projects/{id}/chat` lists sessions; `ProjectAgentView` gains `id`. Web: session rail
(Conversations + New chat), pinned header (← Agents + AgentAvatar + deity + role chip +
status·tool), deity attribution, run-narration console cards, prototype composer (mic disabled —
voice is a future slice); **live EventSource** over `?live=1` (deltas append live; replaces the S8
O(n²) replay-per-send; one-shot resync fallback); tile Chat action deep-links `?agent=<id>`.
**Verified:** typecheck + lint · 653 Docker-free · `test:int` 19 · **BDD 160 scenarios / 1318
steps** · **Playwright 18** · fidelity screenshot vs `capturas/07-chat-voz.png` approved by the
owner. Known deltas (all prior owner decisions): no mic copy (voice deferred), no "View session"
button (Session view blocked on timeline data). (The "no sidebar Log out" delta once noted here was
stale — the control shipped with the slice-7 shell; slice 18 verified + covered it.)

## Programa paralelo v2 — S13+S15+S16+S17+S18 — DoD COMPLETE (2026-07-06, on `main`)

Five streams built in parallel worktrees (announced: `slice-13-stripe`, `slice-15-sso`,
`feat-semantic-embeddings`, `feat-email-adapter`, `feat-logout-ui`), each SDD→BDD→TDD by a Claude
subagent, adversarially reviewed, then integrated with SERIALIZED stack gates and sequential FF
merges. **Keystone v0.5 first, in series** (`207d10b`): +`Invoice`/`InvoiceStatus` + invoice/webhook
routes + SSO routes + **BREAKING owner-approved** `KnowledgeChunk.embedding` vector(1536)→vector(1024).

- **S13 Stripe payments** (`specs/slices/13-stripe-payments/`) — official `stripe` SDK behind the
  extended `PaymentProvider` port (added `listInvoices`/`handleWebhook` per keystone §5);
  `paymentsFromEnv` selector (`PAYMENTS_MODE=offline` or no `STRIPE_SECRET_KEY` → mock — ALL suites
  offline); Checkout Session priced from `PLAN_CATALOG` (annual = 10 charged months); webhooks
  signature-verified over RAW bytes (`configureBodyParser` gained an `express.raw` branch for
  `/billing/webhooks`, same 413 limit); `ApplyPaymentEvent` UoW-atomic seam shared by mock+Stripe
  (`INVOICE_WEBHOOK_EFFECTS`: finalized→OPEN, paid→PAID+ACTIVE, payment_failed→PAST_DUE…); Prisma
  `Invoice` + migration `invoices`; `GET /orgs/:orgId/invoices` (member; non-member 404) +
  `POST /billing/webhooks/:provider` (unauthenticated, signed); BillingScreen Invoices panel.
  Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL/CANCEL_URL`, `PAYMENTS_MODE`.
- **S15 SSO / Google (AC-AUTH-15)** (`specs/slices/15-sso-google/`) — keystone §5 `IdentityProvider`
  implemented verbatim + `SessionIssuingIdentityProvider` extension; Google OIDC code flow (PKCE S256 +
  state + nonce, single-use server-held `SsoStateStore`, `jose` JWKS id_token verification);
  `CompleteSsoLogin` login-or-register (verified email only; new user gets an UNUSABLE Argon2id
  password — the column stays NOT NULL); routes `GET /auth/sso/:provider/start|callback` (rate-limited;
  all failures collapse to one indistinguishable `302 /login?sso=failed`); LoginScreen Google entry +
  `?sso=` notices. SECURITY INVERSION vs the brain pattern: missing config ≠ stub (auth bypass) —
  the stub needs explicit `SSO_MODE=offline` and refuses `NODE_ENV=production`.
  Env: `GOOGLE_CLIENT_ID/SECRET`, optional `GOOGLE_REDIRECT_URL`, `SSO_MODE`.
- **S16 semantic embeddings (Voyage)** (`specs/slices/16-semantic-embeddings/`) — `EMBED_DIM`
  1536→1024; `VoyageBrainEmbedder` (fetch, `voyage-4`, `input_type` query/document, explicit
  `output_dimension`, batches + 1 retry, the key never leaks) behind the S16 optional `embedAs` port
  extension (frozen `embed()` untouched); `SelectingBrain` routes embeddings independently of the
  Anthropic key (BYOK chat never forks the shared embedding space); EMBED `BrainUsage` metering
  (tier HAIKU, org-attributed; global corpus ingest unmetered by design); DESTRUCTIVE migration
  `embedding_vector_1024` (wipes chunks+documents; the seeder re-seeds, `ingest:corpus` reloads —
  Voyage-capable when `VOYAGE_API_KEY` is set). Env: `VOYAGE_API_KEY`, `VOYAGE_MODEL`.
- **S17 SMTP email** (`specs/slices/17-email-smtp/`) — `SmtpEmail` (nodemailer over an injected
  transport seam) behind the frozen `EmailPort`; `emailFromEnv` (`EMAIL_MODE=offline` or no
  `SMTP_URL` → the S12 recording stub); transport errors re-thrown credential-scrubbed (URL +
  password raw/decoded, NO `cause` chaining). Env: `SMTP_URL`, `EMAIL_FROM`, `EMAIL_MODE`.
- **S18 logout UI** (`specs/slices/18-logout-ui/`) — honest verification slice: the control already
  existed end-to-end (slice-7 shell); added the missing coverage only (API e2e revocation+CSRF,
  router-level web units, Playwright `logout.spec.ts`).
- **Verified (post-merge on `main`):** typecheck + lint · **801 Docker-free** (domain 104 ·
  application 300 · ui 25 · api 224 · web 148) · `test:int` 19 · **BDD 182 scenarios / 1517 steps** ·
  **Playwright 18**. All four harnesses pin `BRAIN_MODE/SSO_MODE/EMAIL_MODE/PAYMENTS_MODE=offline`.
- **Process notes:** stack gates must run against FRESH servers — `reuseExistingServer` can silently
  reuse a stale api/vite pair from another worktree (kill 3001/5173 first); apply new Prisma
  migrations to the shared dev DB (`db:deploy`) BEFORE `test:int`/`test:bdd`; one chat SSE Playwright
  flake observed (narration timing) — BDD covers that path deterministically.
- **Deferred:** ~~token-billing~~, ~~Voyage BYOK~~, ~~Redis `SsoStateStore`~~ (all CLOSED by programa
  v3, below) · Stripe portal/proration/refunds · voice STT/TTS.

## Programa paralelo v3 — S14+S19+S20+Redis-SSO+Vitest3 — DoD COMPLETE (2026-07-06 PM3, on `main`)

Five streams in parallel `pnpm wt` worktrees (announced: `slice-14-token-billing`, `feat-voyage-byok`,
`feat-sso-redis-state`, `feat-secret-vault`, `feat-vitest-3`), all built by Claude subagents — the
external-CLI experiment is DEAD on this machine: agy requires `--dangerously-skip-permissions`
(classifier-denied) and codex's `workspace-write` sandbox cannot spawn child processes on Windows
(0xC0000142; all three codex runs aborted cleanly touching nothing). **Keystone v0.6 first, in series**
(`25f4149`): +`voyage` (§8) · `Subscription.brainTokensQuota/brainTokensUsed` (§2) · §9 AI-token
allowances (FREE 100k · STARTER 2M · GROWTH 10M · SCALE unlimited; billable = input+output, cache
EXCLUDED). Every stream: SDD→BDD→TDD + adversarial cross-review with real mutation testing + serialized
FF merges **C→D→A→B→E** (order swapped B↔A mid-flight when B needed a fix round), full stack gate re-run
per merge.

- **S14 token billing** (`specs/slices/14-token-billing/`, 9 BDD AC-TOKB-01..07) — per-plan AI-token
  quota + blocking: allowances DERIVE from `PLAN_CATALOG.aiTokensPerMonth` (single source, slice-10
  pattern); `BrainBilling` seam = pre-check BEFORE the brain call + charge of ACTUAL usage in the SAME
  UoW transaction as the `BrainUsage` row (raw-SQL atomic increment); all org-attributed surfaces
  (CHAT/ROUTER/GENERATE/EMBED; global corpus ingest stays unmetered); blocked chat sends NARRATE
  (never 402/500), other surfaces → `QUOTA_EXCEEDED`→402; SCALE never blocks; migration w/ per-plan
  backfill; Billing AI-usage card gains the quota meter. Review fixes: `save()` no longer persists
  usage counters (also closes the identical pre-existing slice-4 `runMinutesUsed` lost-charge race) ·
  charge saturates at 2e9 (bigint-cast intermediate, int4-safe). **S14-6:** no auto-reset exists today
  (run-minutes never reset either); the future rollover job must reset BOTH counters together.
- **S19 Voyage BYOK** (`specs/slices/19-voyage-byok/`, 6 BDD) — per-org voyage key via the S6 flow
  (`VoyageKeyVerifier` 1-embed ping in auto mode; vault; secretRef only; the raw key traced to appear
  NOWHERE — mutation-verified) + call-time `forOrg` resolution on the shared `resolveOrgProvider`
  pipeline (anthropic path refactored onto it, zero regressions). **Coherence gate (owner decision
  S19-6):** the org key embeds ONLY when the platform voyage space exists (`VOYAGE_API_KEY` present —
  same voyage-4 space, org key = billing/attribution); platform-keyless keeps every embed path lexical
  (the integration row is not even read) so connecting a key can never degrade retrieval. Per-chunk
  embedding provenance + re-embed on connect = named future slice (also the prerequisite for any
  embedding-model upgrade).
- **S20 secret vault** (`specs/slices/20-secret-vault/`) — `AzureKeyVaultSecretVault`
  (@azure/keyvault-secrets + DefaultAzureCredential) behind the frozen S6 `SecretVault` port;
  `vaultFromEnv` with the S15 security INVERSION (stub only under explicit `VAULT_MODE=offline`,
  refused in prod; missing config = clear boot error — dev `start:dev` shells need the offline pin;
  all 5 harness pins added beside the other `*_MODE`s); secretRef contract byte-identical to the stub
  (`vault://<scope>`); scope→name encoding INJECTIVE against KV's case-INSENSITIVE namespace (review
  fix: passthrough strictly `[0-9a-z]`, uppercase escapes as `-hh`); errors value-scrubbed, no `cause`.
- **Redis `SsoStateStore`** (S15 addendum §14) — OIDC state single-use via atomic `GETDEL` + native
  PX TTL, `sso:` prefix, selected by `REDIS_URL` (the RateLimitStore idiom); in-memory default intact;
  + the review follow-up REDIS_URL pin in `sso.e2e.test.ts`. Both critical behaviors mutation-verified.
- **Vitest 3 toolchain** — vitest 2.1.8→3.2.7 + vite 6.4.3 workspace-wide; ZERO test/source/config
  adaptations needed (all 103 new v3-stream tests pass under vitest 3 unmodified); scoped
  `tsup>esbuild>=0.28.1` override; **`pnpm audit`: 6 vulns (1 critical) → 0**.
- **Verified (post-merge on `main`):** typecheck + lint · **918 Docker-free** (domain 106 ·
  application 343 · ui 25 · api 290 · web 154) · `test:int` 23 · **BDD 198 scenarios / 1680 steps** ·
  **Playwright 18** · audit clean. Harness pins now BRAIN/SSO/EMAIL/PAYMENTS/**VAULT**_MODE=offline.
- **Process notes (new):** after merging a schema-changing branch, run `prisma generate` in the main
  checkout BEFORE its gate (`pnpm install` alone does not regenerate; gate A failed typecheck on the
  stale client) · long background gates were killed twice mid-Playwright by the environment — run
  stack gates in foreground chunks · worktrees created before a serial docs commit diverge; rebase
  onto main before the FF merge.
- **Deferred:** pre-existing tsup DTS break (`TS2552: Cannot find name 'URL'` in S15
  `stub-identity-provider.ts`; package builds are in no CI gate) · UI hint for a connected-but-gated
  voyage key · CI-level `BRAIN_MODE=offline` belt+braces pin · provenance/re-embed slice · billing
  rollover job (resets BOTH counters) · Voyage live smoke (@manual) · Stripe portal/proration/refunds ·
  voice STT/TTS · Bloque 3 (owner decision).

## Staging deploy (F0-F4) — DEPLOYED + LIVE on Azure Container Apps (F4: 2026-07-09, supervised)

`specs/infra/staging-deploy.md` (owner decisions SD-1..4: **Azure Container Apps** · **prod-like Key
Vault** (`NODE_ENV=production`, never `VAULT_MODE=offline`) · **the API serves the SPA** (one container,
one origin) · **owner `az login` + supervised agent execution**). Three parallel worktree streams
(`feat-staging-deploy`/`-image`/`-bicep`), each adversarially reviewed with real mutation testing,
merged FF A->B->C with full gates per merge:
- **api (A)** — `WEB_DIST_DIR` serving (`apps/api/src/common/web-dist.ts`: static with immutable
  caching only for hashed js/css, SPA fallback excluding exactly `/api/v1`+`/health` — bare `/health`
  stays a loud JSON 404, probes use `/api/v1/health`); **`REDIS_URL` now optional** (absent -> in-memory
  rate-limit/SSO stores + prod boot WARN; correct ONLY single-replica — must change together with
  maxReplicas). Flag absent = zero change (all harnesses untouched).
- **image (B)** — 2-stage `Dockerfile` (pnpm workspace -> vite build -> node:22-slim + swc-node runtime,
  non-root, openssl in BOTH stages for the Prisma engine flavor), `docker/entrypoint.sh` (`migrate
  deploy` then boot; failure = visible container exit), `.dockerignore` (secrets + heavyweights out of
  the build context, incl. `*.bicepparam`), `docker-compose.staging.yml` (own project name
  `gilgamesh-staging`, TCP `pg_isready`, app healthcheck, `--wait`; local-only delta
  `NODE_ENV=development`+`VAULT_MODE=offline` because the prod vault path needs Managed Identity),
  `playwright.staging.config.ts` + `staging-smoke.spec.ts` (excluded from the default suite).
- **bicep v2 (C)** — two-phase `deployApp` (platform first, app after `az acr build`); single app with
  the REAL env matrix (`AZURE_KEY_VAULT_URL`, conditional `ANTHROPIC_API_KEY` — no placeholder can ever
  select the real brain), probes `/api/v1/health` (`timeoutSeconds: 5`), scale 0..1, `uriComponent()`
  on the DSN password, KV **Secrets Officer** for the S20 runtime vault, SB/Blob/runners param-gated
  OFF; compiles clean via the `mcr.microsoft.com/azure-cli` container (az/bicep are not installed).
- **Verified:** typecheck · lint · **930 Docker-free** (+12) · `test:int` 23 · **BDD 198/1680** ·
  **Playwright 18** (default; staging smoke excluded) · **staging image built from main, compose stack
  Healthy, staging smoke 1/1 green** · bicep recompiled clean post-merge.
- **F4 (deploy) — DONE, LIVE:** `https://app.ashygrass-47d0b048.eastus2.azurecontainerapps.io` (RG
  `rg-gilgamesh-staging`, resource suffix `lcnkcd`, brain=stub — no `ANTHROPIC_API_KEY` yet). Owner
  `az login` + supervised agent execution (SD-4). Verified end-to-end on the real HTTPS origin: health +
  readiness (=DB reachable) + the full **§7 Playwright staging smoke 2/2** (auth+onboarding+agent-room+
  cookies `__Host-gg_session`+`csrf`+404-JSON+deep-link+knowledge-search · **lab→chat-SSE→run-narrated**,
  the latter added to `staging-smoke.spec.ts` to close the §9 ACA-SSE risk).
- **Two subscription-offer restrictions hit + worked around (baked into runbook §8):** (1)
  `LocationIsOfferRestricted` — Postgres Flexible refused in eastus2 → **Postgres in `centralus`** (owner
  Path A), app/ACR/KV/LAW stay eastus2, app↔DB cross-region; `main.bicep` gained `postgresLocation` +
  `postgresServerName` params (the latter dodges the `InvalidResourceLocation` ghost-stub a failed create
  leaves on the derived name). (2) `TasksOperationsNotAllowed` — `az acr build` refused → **local Docker
  build + push** (single-arch, `--provenance=false --sbom=false` for a clean ACA-pullable manifest).
  Prereq the module omits: the deploying principal needs **Key Vault Secrets Officer** at RG scope BEFORE
  phase 1 (RBAC vault; Owner ≠ data-plane). On any failure: re-run idempotently, NEVER delete the KV
  (purge-protection locks the name 90 days). Cost ~US$20-25/mo, Postgres stoppable when idle.

## Programa paralelo v4 — tsup-dts + ci-pin + voyage-hint + billing-rollover + web-error-boundary — DoD COMPLETE (2026-07-07, on `main`)

Five NO-KEYSTONE follow-ups built in parallel `pnpm wt` worktrees (announced: `fix-tsup-dts`,
`feat-ci-brain-pin`, `feat-voyage-ui-hint`, `feat-billing-rollover`, `feat-web-error-boundary`), each
by a Claude subagent, adversarially reviewed with real mutation testing, merged FF sequentially with
gates. All chosen keystone-free so they could run in parallel without serializing.
- **fix-tsup-dts** — closes the pre-existing `@gilgamesh/application` DTS build break: root cause was
  `@types/node` only leaking in transitively via vitest, so tsup's isolated `--dts` worker never saw
  the Node globals `URL`/`Buffer`. Fix = declare `@types/node` as an explicit devDep (no source/DOM-lib
  change). `pnpm --filter @gilgamesh/application build` now emits `.d.ts` + `.d.cts`.
- **feat-ci-brain-pin** — workflow-level `env:` in `ci.yml` pins BRAIN/SSO/EMAIL/PAYMENTS/VAULT_MODE=
  offline across all jobs (belt+braces vs a leaked provider key). Verified NO CI job runs
  NODE_ENV=production, so the two inverted pins (VAULT/SSO) are always accepted; the e2e job sets its
  own explicit NODE_ENV=development + offline via the Playwright webServer.
- **feat-voyage-ui-hint (slice 22)** — additive optional `platformVoyageActive?: boolean` on the
  `IntegrationView` (voyage row only), derived from a new `PlatformEmbeddingStatus` port that
  `SelectingBrain` implements as `embeddings === 'voyage'` — EXACTLY the S19-6 coherence gate.
  Integrations UI shows an amber "connected — inactive" hint only when a voyage key is connected AND
  the platform has no Voyage space. No route, no migration, no keystone. Review APPROVE, zero mutation
  survivors (the false-reassurance inversion is caught by multiple tests).
- **feat-billing-rollover (slice 21)** — closes S14-6: `ResetBillingUsage` + `SubscriptionRepository.
  resetUsage(orgId?)` zeroes BOTH `runMinutesUsed` and `brainTokensUsed` TOGETHER in one atomic raw-SQL
  UPDATE (never `save()` — writes the constant 0, reads nothing, so it can't clobber a concurrent
  charge); both wirings; operator script `rollover-billing.mjs` (no HTTP route). Review round fixes:
  F1 de-vacuoused the in-memory scope test (was self-comparison; a seats-mutation had survived), F2 the
  script now REQUIRES explicit `--all` (a bare call is refused so a forgotten `--org` can't zero every
  tenant), F3 an int smoke shells the real script (drift guard for the duplicated SQL), F4 DSN scrubbed
  from error logs. Counter-vs-ledger divergence documented (the all-time BrainUsage view is unaffected).
- **feat-web-error-boundary (slice 23)** — a React `ErrorBoundary` (inner, keyed by `pathname` around
  the routed `<Outlet/>` for auto-recovery + SSE-preserving query changes; top-level `alwaysDark`
  catch-all). Fixed message only — never leaks stack/PII (console.error dev-only). Review APPROVE + a
  follow-up AppLayout test that pins the `key={pathname}` wiring (killed 2 surviving key mutations).
- **Verified (post-merge on `main`):** typecheck · lint · **963 Docker-free** (domain 106 ·
  application 357 · ui 25 · web 171 · api 304) · `test:int` **32** (+9: billing atomic + script smokes) ·
  **BDD 203 scenarios / 1734 steps** · **Playwright 18**.
- **Deferred (unchanged):** provenance/re-embed slice (needs keystone+migration) · Stripe
  portal/proration/refunds · billing period scheduler (a cron that calls `rollover:billing --all` at
  each boundary; also period-scope the all-time usage view) · voice STT/TTS · Bloque 3 (owner decision).

## Programa paralelo v5 (hardening) — request-id + web-http-resilience + bundle-size + health-readiness + ui-async-states — DoD COMPLETE (2026-07-07, on `main`)

Five NO-KEYSTONE hardening follow-ups (oriented at the imminent deploy) in parallel `pnpm wt` worktrees
(announced: `feat-api-request-id`, `feat-web-http-resilience`, `feat-bundle-size-gate`,
`feat-health-readiness`, `feat-ui-async-states`), each SDD→TDD by a Claude subagent, adversarially
reviewed with real mutation testing, merged FF sequentially with a final integrated stack gate.
- **request-id (slice 24)** — X-Request-Id correlation middleware (registered first in main.ts) +
  additive `requestId` member on the RFC9457 error body + logged with the stack on an unmapped 500;
  a client id is trusted only when a sane bounded opaque token (≤128, `[A-Za-z0-9._-]`), else a fresh
  UUID (header/log-injection guard). Review APPROVE; the CRLF-injection crux proven empirically (JS `$`
  without `m` = `\z`, rejects a trailing `\n`) + a direct `normalizeRequestId` unit test added; 0 survivors.
- **web-http-resilience (slice 25)** — `http.ts` gains a per-attempt `AbortController` timeout + bounded
  retry-with-backoff for idempotent GETs on {502,503,504}/network + a typed `HttpError`
  (`.message === .detail`, back-compat); MUTATIONS ARE NEVER RETRIED (a replayed POST could
  double-charge — mutation-proven). Review APPROVE; F1 fix routed the raw-fetch agents/knowledge clients
  through getJson/sendJson so `getAgentRoom` (a primary dashboard GET) no longer hangs forever; F2/F3
  pinned the {502,503,504}-only classification + the success-path clearTimeout (killed 2 survivors).
- **bundle-size-gate (slice 26)** — dependency-free (`node:zlib`) gzipped JS+CSS budget checker
  (`apps/web/bundle-budget.json`, baseline 109 kB / budget 126 kB) + a dedicated `bundle` CI job
  (single build, SHA-pinned). Closes the slice-1 follow-up gate.
- **health-readiness (slice 27)** — `/api/v1/health/ready` (Prisma `SELECT 1` with a 2s race timeout →
  200 ready / 503 not-ready via `@Res` passthrough) DISTINCT from liveness `/api/v1/health` (constant,
  NO DB dependency — so ACA holds traffic on DB-down instead of crash-looping); `ReadinessProbe` port
  (AlwaysReady in-memory / Prisma probe) bound per wiring; bicep Readiness probe added. Review APPROVE,
  both critical invariants (liveness-no-DB, false-ready-impossible) mutation-proven; 0 survivors.
- **ui-async-states (slice 28)** — reusable `Spinner`/`ErrorState`/`EmptyState` in `@gilgamesh/ui`
  (accessible: role status/alert, reduced-motion, tokens only; CSS in the ui styles.css, NOT
  apps/web/index.css) adopted in `ReportsScreen`. Review APPROVE + the effect active-guard restored
  (review #1); 0 survivors.
- **Verified (post-merge on `main`):** typecheck · lint · **1027 Docker-free** (domain 106 ·
  application 357 · ui 39 · web 189 · api 336) · `test:int` **34** · **BDD 203 scenarios / 1734 steps** ·
  **Playwright 18** (one transient smoke flake, green on isolated + full re-run) · bicep recompiles clean.
- **Deferred (unchanged):** provenance/re-embed slice (keystone+migration) · Stripe portal/proration ·
  billing period scheduler · CORS `Access-Control-Expose-Headers: X-Request-Id` (trivial) · voice ·
  Bloque 3 (owner decision).

## Programa paralelo v6 (deploy-ops hardening) — graceful-shutdown + structured-logging + db-pool + connection-banner + adopt-async-states — DoD COMPLETE (2026-07-08, on `main`)

Five NO-KEYSTONE deploy/operability follow-ups (oriented at the ACA staging deploy) in parallel `pnpm wt`
worktrees (announced: `feat-graceful-shutdown`, `feat-structured-logging`, `feat-db-pool-config`,
`feat-web-connection-banner`, `feat-ui-adopt-async-states`), each SDD→TDD by a Claude subagent, adversarially
reviewed with real mutation testing, merged FF sequentially with a final integrated stack gate. All five
claimed distinct slice numbers (29–33) — no spec collisions; no schema change → no migration/`prisma generate`.
- **graceful-shutdown (slice 29)** — zero-downtime ACA rolling deploys: a `ShutdownState` (`@Injectable`,
  in `APP_PROVIDERS`) whose `draining` flag flips on SIGTERM; `HealthController.ready()` returns 503
  `not-ready` when draining BEFORE the DB probe, while liveness `check()` stays a constant DB-free 200 (so
  ACA holds traffic off the replica instead of crash-looping it). `createShutdownHandler()` = beginDraining →
  wait `SHUTDOWN_GRACE_MS` (default 10s) → `app.close()`, idempotent via a `started` guard. `main.ts` carves
  SIGTERM OUT of `enableShutdownHooks(...)` (keeping the other signals) so Nest's default immediate-teardown
  can't defeat the grace; `app.close()` still runs the hooks → Prisma `$disconnect`. Review APPROVE, 5/5
  mutations caught incl. the critical liveness-never-flips; 0 survivors. **Post-review (advisor-caught) ACA
  drain-contract fix:** the deploy-side half was unverified — the slice-27 bicep readiness probe was
  `periodSeconds 10 × failureThreshold 3 = 30s` against the app's default 10s grace, so `app.close()` would
  fire long before ACA observed `not-ready` → the drain a **no-op on ACA** despite green app tests. Fixed in
  `containerApps.bicep`: readiness `periodSeconds 10→5` (15s detect, keeps the 3-failure tolerance) +
  `SHUTDOWN_GRACE_MS=20000` env, so `15s < 20s grace < 30s ACA SIGKILL`; contract documented in
  `staging-deploy.md §5`; bicep recompiles clean.
- **structured-logging (slice 30)** — `LOG_FORMAT=json` swaps Nest's pretty ConsoleLogger for a single-line
  JSON `LoggerService` (`{level,time,context,message,stack?}`, fixed key allowlist, `error`→stderr,
  never-throws try/catch) for Azure Log Analytics; unset/`pretty`/any-unrecognised → `undefined` selector →
  `useLogger` never called → zero change. Review APPROVE, 5/5 mutations caught incl. the no-secret-leak
  allowlist; 0 survivors. (Config+main.ts overlapped slice 29 — resolved keeping both fields/insertions.)
- **db-pool-config (slice 31)** — bounded, configurable Prisma connection posture for a single small B1ms
  replica: `withPoolDefaults` appends `connection_limit=5`/`pool_timeout=10`/`connect_timeout=10` (seconds)
  only when ABSENT (never overrides operator-set params), env overrides `DB_CONNECTION_LIMIT`/`DB_POOL_TIMEOUT_S`/
  `DB_CONNECT_TIMEOUT_S`; passed via the Prisma 6 `datasourceUrl` ctor option (schema.prisma untouched → migrate
  unaffected; `DATABASE_URL` unset → zero change); `connectWithRetry` (2 retries, injectable sleep, rethrows the
  last error unmodified → no false-healthy). Review APPROVE, 5/5 mutations caught; 0 survivors. Encoded-password
  (`%40`) DSN round-trips through WHATWG URL — staging DSN safe.
- **web-connection-banner (slice 32)** — a global offline banner behind a no-op pub/sub seam: `http.ts` emits
  `reportOnline()` before its single `return res` and `reportOffline()` only at the two terminal
  network/timeout throws — so ANY reached-server response (incl. 4xx/5xx and an exhausted-503) reports online
  (no false banner on ordinary API errors), and a retried 502/503/504 `continue` reports NOTHING. Provider
  subscribes to the seam + `window` online/offline, seeds from `navigator.onLine`, mounts OUTSIDE the
  ErrorBoundary. Review APPROVE; the critical false-offline-on-500 invariant caught; **2 survivors CLOSED**
  (retry-blip stays online + provider unsubscribes the seam on unmount — both added mutation-verified).
  Coverage boundary (raw-fetch auth/onboarding clients + chat SSE) documented.
- **ui-adopt-async-states (slice 33)** — adopts the slice-28 `Spinner`/`ErrorState`/`EmptyState` primitives in
  Billing (loading+load-failure w/ retry), Integrations (load-failure w/ retry), Knowledge (empty) per a locked
  load-lifecycle-vs-action rule; `index.css` + `packages/ui` untouched. Fixed a latent bug: `load` now clears
  `error` at the top so a successful retry doesn't leave a stale banner. Review APPROVE; **1 survivor CLOSED**
  (assert EmptyState absent when a search has results). EmptyState titles drop the trailing period → one exact-
  string Knowledge **e2e** assertion updated to match (the unit regex hadn't caught it).
- **Verified (post-merge on `main`):** typecheck · lint · **1095 Docker-free** (domain 106 · ui 39 ·
  application 357 · web 214 · api 379) · `test:int` **39** · **BDD 203 scenarios / 1734 steps** ·
  **Playwright 18/18** (one real slice-33 e2e copy regression found + fixed, then 18/18 clean).
- **Process notes:** merging the two config/main.ts-overlapping api streams (29,30) first, in order, isolated
  the single conflict to one resolve; the 3 isolated streams (31 prisma, 32/33 web) rebased clean · the
  Docker-free gate does NOT run e2e, so a slice's unit tests passing ≠ its e2e passing — an EmptyState copy
  change (period-less) slipped past the period-less unit regex but broke the exact-string e2e; run the
  Playwright gate before declaring a UI slice done.
- **Deferred:** structured-logging follow-ups — Nest's pre-`useLogger` bootstrap lines still emit pretty/ANSI
  in json mode (`bufferLogs:true` would route them through the JSON logger too) · `JsonLogger.fatal()`
  unimplemented (latent — no `.fatal` calls) · db-pool int test doesn't independently prove params reach the
  engine · everything from v5 unchanged (provenance/re-embed · Stripe portal/proration · billing scheduler ·
  voice · Bloque 3 owner decision).

## Programa paralelo v7 (debt-closure + hardening) — stripe-portal + logging-cors + db-pool-proof + web-async-states + ci-sha-comments — DoD COMPLETE (2026-07-09, on `main`)

Five NO-KEYSTONE follow-ups (owner-approved *set recomendado no-keystone*) in parallel `pnpm wt` worktrees
(`slice-34-stripe-portal`/`-35-logging-cors`/`-36-db-pool-proof`/`-37-web-async-states`/`-38-ci-sha-pin`),
each SDD→(BDD)→TDD by a Claude subagent verifying **Docker-free only** (Tier-0: shared Postgres/Redis/ports →
subagents must NOT run int/bdd/e2e), then integrated by the orchestrator with **serialized** stack gates +
sequential FF merges (34-38 = slices 34-38). No schema change → no migration. Design doc:
`docs/superpowers/specs/2026-07-09-programa-v7-design.md`. Merged branches from v2-v6 were pruned first.
- **stripe-portal (slice 34)** (`specs/slices/34-stripe-portal/`, 6 BDD AC-PORTAL-01..05) — Stripe **Customer
  Portal, portal-only** (owner decision: hosted UI covers plan-change/proration/payment-method/cancel;
  programmatic refund/proration APIs deferred): additive `PaymentProvider.createPortalSession(orgId)`
  (**keystone untouched** — S13 `listInvoices`/`handleWebhook` precedent); `StartBillingPortal` (OWNER/ADMIN;
  non-member → 404; no Stripe customer yet → `VALIDATION`/422, never 500); `MockPaymentProvider` deterministic
  offline `https://mock.pay/portal/<orgId>`; `StripePaymentProvider.billingPortal.sessions.create` +
  `STRIPE_PORTAL_RETURN_URL` (→ `STRIPE_SUCCESS_URL` → `/billing`); dedicated `BillingPortalController` at
  `orgs/:orgId/billing` (a conscious split — `BillingController` hangs off `/subscription`, so the literal
  keystone path needed its own controller; no route collision with `/billing/webhooks`) → `POST
  /orgs/:orgId/billing/portal`; BillingScreen "Manage billing" button (navigates on success). Stripe key
  never reaches the portal path (no-leak test). `PAYMENTS_MODE=offline` → mock (all suites offline).
- **logging-cors (slice 35)** (`specs/slices/35-logging-cors/`) — closes the v6 structured-logging deferreds +
  the v5 CORS deferred: `NestFactory.create(..., { bufferLogs: true })` so Nest's pre-`useLogger` bootstrap
  lines route through the JSON logger in json mode (pretty mode → `app.flushLogs()` drains the buffer through
  the default ConsoleLogger, **zero-change** dev output); `JsonLogger.fatal()` implemented → **stderr** via an
  `isErrorLevel` helper (same stack/context parse as `error`); `enableCors({ exposedHeaders:
  [REQUEST_ID_HEADER] })` so a cross-origin SPA can read `X-Request-Id` off `fetch` (reuses the constant, no
  literal drift). Bootstrap-path effects (AC-LC-02/03/04) aren't Docker-free-testable — `main.ts` isn't run by
  the harness; the `fatal` unit test is the automated proof.
- **db-pool-proof (slice 36)** (`specs/slices/36-db-pool-proof/`) — closes the v6 gap ("int test doesn't prove
  params reach the engine"): an ENGINE-LEVEL int test that a `connection_limit=2` client (built via the
  production `withPoolDefaults`) never holds >2 concurrent backends under CONCURRENCY=6 `pg_sleep` load — an
  independent observer client polls `pg_stat_activity` (filter keys off the intrinsic `pg_sleep`, self-excludes
  via `pg_stat_activity` text + `pg_backend_pid()`), asserting `peak >= 1` (non-vacuous) AND `peak <= LIMIT`.
  Read-only, cleans up both clients in `afterAll`. **Orchestrator fix round:** the subagent's `SELECT
  pg_sleep(…)` returned SQL `void` which Prisma can't deserialize → rewrote as `SELECT 1 AS ok FROM pg_sleep(…)`
  (caught only by the serial `test:int`, NOT by Docker-free typecheck/unit).
- **web-async-states (slice 37)** (`specs/slices/37-web-async-states/`) — adopts the slice-28
  `Spinner`/`ErrorState`/`EmptyState` in the remaining screens (Dashboard/AgentRoom, Test Lab, Chat),
  load-lifecycle only. AgentRoom = Spinner+ErrorState (no EmptyState — the room is a fixed 11-agent roster).
  TestLab = Spinner+ErrorState+EmptyState (the empty banner coexists with the authoring forms). **Chat = rail
  only:** new `sessionsLoaded`/`sessionsError` scope the rail Spinner/ErrorState; the live SSE path
  (`openLive`/DELTA/MESSAGE/DONE/send/resync) is byte-for-byte unchanged (diff-verified). `index.css` +
  `packages/ui` untouched; EmptyState titles period-less.
- **ci-sha-comments (slice 38)** — the premise was **stale**: SHA-pinning was already done (an earlier
  CI-hardening pass; the `~~pin GitHub Actions to SHA~~ (done)` audit note). The delta shipped is comment
  precision only — version comments upgraded major→concrete semver (`# v4` → `# v4.3.1`, codeql's mildly-stale
  `# v3` → `# v3.36.3`, …) resolved via `gh api .../commits/<tag>`; **SHAs byte-identical** (17/17 lines), helps
  Dependabot. Zero risk, no stack gate needed (YAML validated).
- **Verified (post-merge on `main`):** typecheck · lint · **1122 Docker-free** (domain 106 · ui 39 ·
  application 362 · web 226 · api 389) · `test:int` **40** · **BDD 209 scenarios / 1779 steps** ·
  **Playwright 18/18** (one known chat-SSE-narration timing flake, green on isolated re-run).
- **Process notes:** the Docker-free gate does NOT run `test:int` — slice 36's `void`-deserialize bug passed
  typecheck+unit but was caught only by the serial `test:int`; run the stack gate before declaring even a
  test-only int slice done · slice branches cut before the CI merge showed a phantom `.github/workflows` diff
  (behind main) → rebase onto main before the FF-merge (all 5 rebased clean, disjoint) · running the `test:int`
  gate WHILE the Docker-free subagents built flaked the `knowledge-upload`/`rate-limit` int TRUNCATE hooks
  (10s hook timeout under CPU starvation, `collect` 30s→59s) — run stack gates on a quiet machine, one at a time.
- **Deferred:** ~~structured-logging bootstrap lines / `JsonLogger.fatal`~~ (CLOSED, slice 35) · ~~db-pool
  engine-level proof~~ (CLOSED, slice 36) · ~~CORS expose `X-Request-Id`~~ (CLOSED, slice 35) · ~~pin GitHub
  Actions to SHA~~ (was already done; comments now concrete, slice 38) · Stripe portal→programmatic
  proration/refunds · billing period scheduler · provenance/re-embed slice · voice STT/TTS · Bloque 3 (owner
  decision — now minus the closed SHA-pin).

## Responsive design pass — DoD COMPLETE (2026-07-09, on `main`)

`docs/superpowers/specs/2026-07-09-responsive-design.md` — a stakeholder video showed the app looking broken
on a real iPhone against staging. Root cause: the authenticated shell had **zero mobile adaptation** —
`.gx-shell { grid-template-columns: auto 1fr }` + `.gx-sidebar { width: 236px }` with no `@media`, so the
sidebar stayed a fixed 236px column stealing ~60% of a 390px viewport and forcing horizontal overflow (the
viewport meta was already correct). Owner-approved decisions: mobile nav = **off-canvas drawer** (hamburger
in the Topbar); scope = shell + all 7 authenticated screens; Chat rail = drawer/toggle; breakpoints
mobile ≤767 / tablet 768–1023 / desktop ≥1024 with **desktop byte-for-byte unchanged**. Built as ONE
cohesive stream (responsive lives in shared `packages/ui/styles.css` + `apps/web/index.css` → NOT a
worktree fanout), verified with Playwright mobile screenshots.
- **Phase 1 — shell drawer** (`packages/ui`, `555e9cf`): additive mobile-nav channel on `AppShell`/`Sidebar`/
  `Topbar` (`mobileNavOpen`/`onToggleMobileNav`/`onCloseMobileNav`, all optional, distinct from desktop
  `collapsed`); `IconMenu` hamburger in the Topbar (`display:none` on desktop → out of the a11y tree);
  backdrop (click-to-close) + Esc-close + focus-return; one `@media (max-width:767px)` block in `styles.css`
  (`.gx-shell` → single column; `.gx-sidebar` → `position:fixed` off-canvas `translateX(-100%)`
  `width:min(84vw,300px)`, slides in on `[data-mobileopen='true']`; `.gx-backdrop`; hides the desktop
  collapse control; `prefers-reduced-motion` respected); `AppLayout` owns the state, closes on route change +
  same-route nav taps, locks body scroll while open. +4 `AppShell` unit tests.
- **Phase 2 — per-screen reflow + chat drawer** (`apps/web`, `e5516f1`): `@media (max-width:767px)` blocks
  collapse multi-column grids to one column, full-width cards, `overflow-x:auto` on wide content. **Chat**:
  two-pane → single pane; the sessions rail becomes a `railOpen` **drawer/toggle** ("Conversations" button +
  backdrop) — the SSE/streaming path (`openLive`/DELTA/MESSAGE/DONE/send/resync) is UNTOUCHED (close-on-tap
  only wraps the existing handlers; `chat.spec.ts` run-narration stays green). New committed
  `apps/web/e2e/responsive.spec.ts` (mobile no-overflow + drawer smoke).
- **Verified (on `main`):** typecheck · lint · **1126 Docker-free** (ui 39→43) · **Playwright 18→19/19**
  (desktop unchanged + mobile smoke). `test:int` 40 / BDD 209/1779 unaffected (no api/domain/application
  change). **No horizontal scroll at 390px on any of the 7 authenticated screens** (was 618–784px overflow);
  the shell drawer + chat rail verified by screenshot. Desktop (≥1024px) byte-for-byte unchanged.
- **Deferred:** pre-auth Login/Register helix-hero responsiveness (separate phase) · a pre-existing 16px
  document overflow at the 768px tablet band on tall/scrollbarred project screens (vertical-scrollbar
  interaction, outside the 390px hard invariant — left to protect the desktop invariant) · native Expo app.

## Admin console — DoD COMPLETE (2026-07-09, on `main`)

`docs/superpowers/specs/2026-07-09-admin-console-design.md` — the internal **administration console** from the
design handoff (`design_handoff_gilgamesh/README-admin.md` + captures 15–22), built in the existing
web stack. Two roles in one panel behind a **role switch**: **Platform** (Gilgamesh HQ back-office) and
**Workspace** (one customer account). Orchestrated as a foundation phase + 4 parallel view groups.
- **Placement/stack:** `apps/web/src/admin/` (React + Vite + React Router 7), a **lazy chunk** (code-split so
  it does NOT inflate the main bundle — reached only at `/admin` · `/w/:wsId/admin`). One dedicated
  `admin/admin.css` (all `.gx-adm*`, NOT `index.css`). Reuses the app's `data-theme` provider; the admin's
  README CSS vars ARE the app's tokens. **New scoped i18n** es/en (`T(lang,key)` + per-view dict modules with
  an es/en key-parity test) — the main app is English-only, so the admin introduces its own.
- **Routes + guard:** `/admin/*` (platform) and `/w/:wsId/admin/*` (workspace), added to `AppRoutes.tsx` under
  a lazy `AdminLayout`, standalone (outside `RequireAuth`). `RoleGuard` is a **seam that permits for now** —
  real staff/owner permission-derivation is the documented follow-up; the switch demonstrates both roles.
- **Data:** typed §7 shapes in `data/types.ts`; complete mock in `data/mock.ts` (the spec's exact figures);
  an `AdminService` interface + `MockAdminService` (real API later). **Cost-visibility rule enforced
  structurally:** workspace-role methods return cost-stripped view-models (no per-project cost, token/minute
  cost, or margins — the fields don't exist at the type level; built by explicit field selection, never a
  spread; runtime-asserted by tests). Platform role sees costs.
- **Views (14):** platform Resumen (cap 15) · Ingresos · Clientes (16) + ClienteDetalle (17) · Planes (18,
  **live-margin recompute** on price edit) · Proyectos (19) + ProyectoDetalle · Uso · Salud (20) · Usuarios ·
  Auditoría (in-memory category filters); workspace Resumen (21) · Proyectos/Uso/Usuarios (scoped, cost-free)
  · Facturación · Ajustes (22, switches + danger zone). No emoji; stroke SVG; mono numbers/folios.
- **Orchestration:** Phase 1 = one cohesive subagent built the foundation (types, mock, service, i18n
  registry, `AdminContext`, shell [sidebar 240px w/ role switch + workspace selector + grouped nav, topbar
  w/ role badge + ES/EN + theme, toast], routes wired to per-view **stub files**, `admin.css` primitives) +
  Resumen fully. Phase 2 = **4 parallel worktree subagents** (Group A clients/projects · B plans/revenue/
  usage/health · C users/audit · D workspace role) each filled its own stub views + own `<view>.css` + own
  i18n modules — **zero shared-file edits** (the seam made it collision-free; each verified on its own vite
  port since the admin is mock-only, no api/DB). Merged rebase+FF, disjoint.
- **Verified (on `main`):** typecheck (all pkgs) · lint · **web 286 tests** (Docker-free; +60: 19 foundation +
  41 across groups incl. cost-stripping + i18n parity + live-margin + filter tests) · bundle-size ok (budget
  bumped for the lazy admin chunk; **main index chunk unchanged 101.9 kB**) · **Playwright 19** (existing app
  e2e unaffected by the added routes). Visual fidelity vs captures 15/16/17/18/20/21/22 confirmed by
  screenshot (dark + light), sidebar stays navy in light.
- **Deferred:** real API behind `AdminService` · real permission-derived `RoleGuard` (replace the demo switch)
  · wire an entry into the app nav for staff · retention seed 60-vs-capture-90 (mock value, flip if desired).

## Staging redeploy + 3 follow-ups — DoD COMPLETE (2026-07-09 noche, on `main`)

Owner `/goal` continuation. Two things this session: (1) **redeployed staging** so the live ACA image
matches `main`, and (2) a small **parallel program** (2 worktree subagents + 1 inline task) of clean,
keystone-free, no-pending-decision follow-ups. All merged to `main` via cherry-pick; one combined stack
gate. Advisor-scoped down from 4 candidate streams to 3 (dropped an in-app billing scheduler — an
`@nestjs/schedule` cron is a no-op under ACA `minReplicas 0`; the reliable path is the existing operator
script / a future ACA Job — recorded, not built).

- **Staging redeploy → image `:3dcd73f`** (was `:b578d7f`) — code-only rollout (zero migrations b578d7f→
  3dcd73f), so: local `docker build --provenance=false --sbom=false` → push to ACR (only the changed layer;
  base identical to F4) → `az containerapp update -n app --image …:3dcd73f`. `az` is NOT on PATH this machine
  → ran every `az` via the `mcr.microsoft.com/azure-cli` container with a **persistent config volume**
  (`gilgamesh-azcli`); owner did the device-code `az login` (SD-4). Postgres-`Ready` gated first (else the new
  revision crash-loops on `migrate deploy`). Verified on the real origin: `/api/v1/health[/ready]` 200/200 ·
  `/admin` renders (a11y tree, lazy chunk loads) · §7 smoke 2/2 green warm (the tight 5s timeouts vs the
  eastus2↔centralus cross-region latency flake on cold start, green when warm). Revision `app--0000002`
  Healthy/100%, `:b578d7f` deprovisioned. (Full rollout recipe recorded in the auto-memory.)
- **A · pre-auth responsive** (`feat-preauth-responsive`, subagent) — closes the deferred pre-auth half of
  the responsive pass. The shared `.gx-auth` hero+card only had a stray `@media (max-width:900px)`; realigned
  to the project breakpoints — hero is now a **desktop-only ≥1024** two-column treatment (`≤1023` hides the
  decorative hero + full-width form; `≤767` tightens the gutter so a 368px form never overflows 390px),
  **desktop ≥1024 byte-for-byte unchanged**. Fixed the genuine bug: `AuthHero`'s `prefers-reduced-motion`
  path drew ONE static canvas frame and never redrew → added a `window` resize→`draw()` listener (audit-#11
  reduced-motion + hidden-tab-pause + full cleanup all preserved). +2 unit tests; new `responsive.spec.ts`
  pre-auth @390 case (Playwright #17, green).
- **C · admin access gate** (`feat-admin-access-gate`, subagent) — the mock admin console was reachable with
  NO session and `RoleGuard` permitted everyone (exposing fabricated MRR/customer figures as if real). Made
  `RoleGuard` the single real gate: `booting`→loader, `!authed`→`/login` (both trees), workspace tree requires
  `wsId === activeOrgId` (else redirect, not-found behavior — no cross-tenant leak), platform tree behind
  `VITE_ENABLE_PLATFORM_ADMIN === 'true'` (**default OFF** → redirect; a stopgap, real staff-permission gate
  is the follow-up). Added a "Demo data" badge in the admin shell; **no nav entry** (stays undiscoverable
  while data is mock). +12 unit tests (full RoleGuard matrix + redirect through the real lazy chunk + badge).
  NOTE: staging still runs the OPEN console until the next redeploy.
- **B · image-asset slim** (inline) — `public/` ships verbatim into the vite build, so oversized assets ship
  even when drawn tiny. `browser-firefox.png` was 3840×3840 / 1.6 MB for a ~44px helix mark. Resized the
  helix/mark icons to fit 256px + recompressed (firefox 1656→14 KB · edge 281→12 · chrome 107→8 · webkit
  102→8 · mark-dark 452→104 KB truecolor to keep the brand gradients), and deleted the unreferenced
  `brand-dark`/`brand-light` exports (~1.5 MB) — **~3.95 MB off the build**. Paths unchanged → no code touched;
  both key assets eyeballed crisp. Closes Bloque-3 E5 ("optimize heavy assets") — no policy needed.
- **Verified (on `main` @ `29688f3`):** typecheck (5 pkgs) · lint · **1200 Docker-free** (domain 106 · ui 43 ·
  application 362 · web 300 · api 389; +14: A 2, C 12) · **Playwright 20/20** (+1 = A's pre-auth @390 case;
  no regression). int 40 / BDD 209/1779 unchanged (zero api/domain/application/prisma changes). **NOT pushed
  to origin** (pending owner) and the 3 slices are **not yet deployed** (a code-only rollout when desired).
- **Deferred/skipped (need an owner policy decision or keystone — not built this round):** Bloque-3 rate-limit
  fail-open · per-IP backoff · pagination · RAG posture (all policy) · billing period scheduler (ACA Job infra)
  · provenance/re-embed (keystone+migration) · Stripe proration/refunds · voice.

## Programa paralelo v8 — per-IP lockout (39) + Stripe proration/refunds (40) — DoD COMPLETE (2026-07-10, on `main`)

Owner `/goal` continuation ("continua en paralelo más features, máximo 4 worktrees"). Owner picked a **2-feature**
tanda from a menu (didn't pad the max). Both **additive — no keystone amendment, no schema migration.** Design
doc: `docs/superpowers/specs/2026-07-10-programa-v8-design.md`. Two disjoint domains (auth/rate-limit vs
billing) → the FF merges touched **zero common files**. **Process note (new):** the slice-39 subagent stalled
mid-stream TWICE (API "Response stalled", 0 bytes persisted both times despite ~30 tool calls) — after the
second stall the orchestrator built slice 39 **inline** (disjoint from the still-running slice-40 subagent), which
is the reliable fallback when a background agent won't converge; incremental commits are the mitigation.
- **per-IP lockout (slice 39)** (`specs/slices/39-ip-lockout/`, AC-IPLOCK-01..07; @wip feature, e2e/unit are the
  executable proof à la AC-AUTH-13) — closes Bloque-3 #4. A **new `AuthAbuseGuard`** (sibling of the untouched
  `RateLimitGuard`, so its proven tests don't churn), bound as a second `APP_GUARD`: **A1** a per-IP request
  ceiling across the auth mutation routes (login/register/forgot/reset share one `auth-ceil:<ip>` budget —
  org-farming/spray) + **A2** an exponential-backoff lockout after N consecutive failed credential attempts
  (`lockedUntilFor`: `base*2^(failures-threshold)` capped at max). Both keyed on **client IP, never per-account**
  (an attacker can only lock their own IP — no victim DoS). New `LoginAttemptStore` port (in-memory + Redis/Lua,
  `REDIS_URL` idiom); a global `LoginOutcomeInterceptor` feeds it (clear on 2xx, record on `INVALID_CREDENTIALS`
  [login] or `VALIDATION` [reset]; a Nest DTO error is not an `ApplicationError` so it's never miscounted).
  **Fail-open** on store outage (matches RateLimitGuard). Config `AUTH_IP_RATE_LIMIT`/`_WINDOW_MS` +
  `AUTH_LOCKOUT_THRESHOLD` (10) `/_BASE_MS` (60s) `/_MAX_MS` (15m). The three sweep harnesses
  (vitest.config/cucumber.cjs/playwright.config) pin the new knobs sky-high (the `AUTH_RATE_LIMIT=1000000`
  idiom) — which also fixed a `rate-limit.e2e` cross-test regression the lockout introduced.
- **Stripe proration + refunds (slice 40)** (`specs/slices/40-stripe-proration/`, AC-PRORATE-01..07) — programmatic
  billing over the existing `providerSubscriptionId`/`providerCustomerId` (NO checkout, NO migration). Additive
  `PaymentProvider.{previewProration,changePlan,refund}` (S13/S34 additive precedent, keystone untouched); a pure
  `packages/domain/src/billing/proration.ts` (single source for both arms). **B-1 = `create_prorations`** (rides
  to next invoice; preview shows the amount). **B-2 = prorated refund of the UNUSED period, opt-in** via
  `CancelSubscription({refund?})` → a credit `Invoice` row (negative `amountCents`, VOID). `ChangeSubscription`
  now prorates when a provider sub exists (else pure-row path, `prorationCents:0`, regression-safe — spy-verified);
  new `PreviewPlanChange` use case + `POST /orgs/:orgId/subscription/preview`; `INVOICE_WEBHOOK_EFFECTS` gains
  `charge.refunded`/`credit_note.created`. Stripe arm (fake `Stripe`, never live): `invoices.createPreview`
  (SDK renamed `retrieveUpcoming`→`createPreview` in 22.3.0) + `subscriptions.update(proration_behavior)` +
  `refunds.create({payment_intent, amount})`; secret no-leak asserted. Mock arm deterministic (Clock-derived
  fraction; the e2e/BDD assert the proration SIGN, exact cents pinned in FakeClock unit tests).
- **Verified (post-merge on `main` @ `4d59e56` + int fix):** typecheck (5 pkgs) · lint · **1267 Docker-free**
  (domain 117 · application 375 · ui 43 · web 305 · api 427; +67) · `test:int` **43** (+3: Redis login-attempt) ·
  **BDD 217 scenarios / 1857 steps** (+8, slice-40 proration; slice-39 @wip) · **Playwright 20/20**. **PUSHED to
  `origin/main`** (`bbc09a1..84c7633`) and **not deployed** (staging still runs `:bbc09a1`; a code-only rollout
  when desired).
- **Two tuning notes surfaced to the owner (advisor-caught, non-blocking — env-configurable, unchanged this
  round):** (1) the A1 per-IP ceiling default (30/min, one bucket across login+register+forgot+reset, counts
  successful logins) is **NAT-hostile** — a corporate egress IP with a login surge could 429 legit users; raise
  the default or scope the ceiling to register/forgot/reset (the A2 failure-lockout already covers login
  stuffing and is NAT-safe). (2) reset-password lockout counts a weak-new-password fumble as a failure, not just
  a bad token (minor, self-resolving). **Both CLOSED 2026-07-12 — see "Programa v8 tuning + staging redeploy".**
- **Deferred:** lockout Retry-After exact math + exponential growth are unit/store-proven (real-time e2e can't wait
  minutes) · Stripe `always_invoice` mode · partial/line-level refunds · a refund-preview endpoint (to show the
  exact "$Z" pre-cancel) · everything prior unchanged (Bloque-3 fail-open/pagination/RAG posture · billing
  scheduler · provenance/re-embed · voice).

## Programa v8 tuning + staging redeploy (2026-07-12) — DoD COMPLETE, DEPLOYED, on `main`+origin

Owner `/goal` continuation. Closed the **two v8 lockout tuning notes** (advisor-caught in v8, left as owner
decisions) inline (SDD→TDD; the slice-39 auth module is the documented-reliable inline path — the v8 subagent
stalled there twice), then **redeployed staging** to the resulting SHA. No keystone, no migration.
- **Tuning 1 — A1 per-IP ceiling scoped off login** (`auth-abuse.guard.ts`): the per-IP request ceiling now
  covers register/forgot/reset only (`AbusePath.ceiling:false` on `/auth/login`). A shared per-IP ceiling that
  counts *successful* logins is NAT-hostile (a corporate egress IP with a login surge → 429 for legit users).
  Login abuse stays bounded by the A2 exponential failure lockout (NAT-safe: failures only, clears on success)
  + the per-account `RateLimitGuard`.
- **Tuning 2 — weak-password reset no longer feeds the lockout** (new `RESET_TOKEN_INVALID` app error code):
  the global `ValidationPipe` maps every DTO failure — incl. a too-short new password — to
  `ApplicationError('VALIDATION')`, which the `LoginOutcomeInterceptor` counted on reset-password. A dedicated
  `RESET_TOKEN_INVALID` (→422, same status; thrown only by `ResetPassword` for a bad/expired/consumed token) is
  now the sole reset failure the lockout counts; a legit weak-password fumble stays `VALIDATION` and no longer
  penalizes the IP. Bad-token attempts still count (AC-IPLOCK-07 preserved). The no-oracle invariant holds (all
  bad-token branches + the double-submit loser share the one code + generic message + 422; BDD asserts status,
  not code, so AC-AUTH-12/AC-REC-02 stay green).
- Proven red→green in `apps/api/test/ip-lockout.e2e.test.ts` (AC-08 weak-reset no-lock, AC-09 login-not-
  ceiling'd) — the pipe→interceptor interaction unit tests can't reach — plus guard/interceptor units + the
  reset-recovery e2e title distinction. Single commit `f6ebf78`.
- **Verified:** typecheck (5 pkgs) · **1272 Docker-free** (domain 117 · application 375 · ui 43 · api 432 ·
  web 305; +5) · `test:int` **43** · **BDD 217 scenarios / 1857 steps** · lint 0.
- **Staging REDEPLOYED → image `:f6ebf78`** (was `:bbc09a1`): code-only rollout (0 migrations), local
  `docker build --provenance=false --sbom=false` → push to ACR (`gilgameshstagingacrlcnkcd`) → `az containerapp
  update`. Revision **`app--0000004`** Healthy · RunningAtMaxScale · 100% traffic. Verified on the real origin:
  `/api/v1/health` 200 · `/api/v1/health/ready` 200 (DB reachable) · **§7 staging smoke 2/2** (SPA+API+same-
  origin session · lab→chat-SSE→run-narrated). Owner already had a valid `az login` (SD-4). PUSHED to
  `origin/main` (`3cda596..f6ebf78`).
- **Closes:** the two v8 lockout tuning notes (Bloque-3 #4 fully closed — refinements included). Both tuning
  levers stay env-configurable (`AUTH_IP_RATE_LIMIT`, `AUTH_LOCKOUT_*`).
- **Deferred (unchanged):** Bloque-3 fail-open/pagination/RAG posture (owner decision) · billing scheduler ·
  provenance/re-embed · Stripe always_invoice/partial-refunds · voice.

## Programa paralelo v9 — keystone v0.7 + refunds (41) + voice (42) + reports per-tool (43) — DoD COMPLETE (2026-07-12, on `main`)

Owner `/goal` continuation. Brainstormed (advisor-scoped) a 3-slice tanda + a **mobile-app charter** (a separate
phased program, NOT built this round). Design: `docs/superpowers/specs/2026-07-12-programa-v9-design.md`; plan:
`docs/superpowers/plans/2026-07-12-programa-v9.md`. Structure: **keystone v0.7 in series first** → 3 parallel
`pnpm wt` worktree subagents (SDD→BDD→TDD, Docker-free-only) → orchestrator serialized integration.
- **Keystone v0.7 (in series on `main` first, `911f281`)** — `RunNode +discipline?` (§2); the persisted
  `RunResult`-lite now carries both `tool` (already on `RunNode`) and `discipline` (both nullable). The
  `DeterministicKernel` emits them deterministically from the unit name (playwright/vitest/k6/zap ·
  e2e/unit/perf/security); `run_results` migration adds the two nullable columns. **Migration gotcha:** `migrate
  dev` auto-added a spurious `DROP INDEX knowledge_chunks_embedding_hnsw_idx` (false drift — the HNSW index is
  raw-SQL Prisma doesn't model); removed by hand so the migration can't destroy the pgvector RAG index.
- **Slice 41 — Stripe refunds** (`specs/slices/41-stripe-refunds/`, AC-REFUND-01..06) — additive to
  `PaymentProvider` (NO keystone, NO migration — reuses `Invoice`): partial **amount-level** `refund({amountCents})`
  clamped to the paid-invoice ceiling → negative-`amountCents` VOID credit row; `previewRefund` sharing ONE pure
  `quoteRefund` source (preview == executed); `changePlan({prorationBehavior: 'create_prorations'|'always_invoice'})`
  (default preserved, spy-verified). `POST /orgs/:orgId/subscription/refund[/preview]`; over-ceiling → 422; secret
  no-leak. Deferred: netting vs prior partial refunds, line-item refunds.
- **Slice 42 — Voice in chat** (`specs/slices/42-voice/`, AC-VOICE-01..05) — a new `VoicePort` (Brain-stub
  pattern): `DeterministicVoice` offline + `AzureVoice` real adapter (injected transport, key credential-scrubbed,
  no `cause`), `voiceFromEnv` selector, `VOICE_MODE=offline` pinned in ALL FOUR harnesses. `POST
  /chat/:sessionId/{transcribe,speak}` (chat RBAC + rate-limit; non-member 404). Web: composer mic (MediaRecorder,
  **batch** record→transcribe→drop-in-composer, no auto-send) + per-message "read aloud" (TTS). **SSE path
  byte-for-byte unchanged** (diff-verified). NO migration/metering (schema-free — VoiceUsage metering deferred).
  Provider = Azure Speech (owner-confirmed; the port keeps it swappable).
- **Slice 43 — Reports per-tool** (`specs/slices/43-reports-per-tool/`, AC-REPORT-TOOL-01..04) — builds against
  frozen v0.7: pure `summarizeByTool` fold (group by tool, 1-decimal `ratePct`, null→`unknown` bucket, deterministic
  order); `RunResultView`/`runView` widened with `tool`/`discipline` (no read-DTO strips them; no schema work);
  ReportsScreen capture-08 "Tools" card (period-less EmptyState). Honesty: renders stub-emitted data until the real
  TOM kernel. Deferred: N+1 `getRun`-per-run (batch runs-with-results endpoint = follow-up).
- **Integration (orchestrator, serialized):** merge **42 first** (largest blast radius → clean FF), then rebased
  41 + 43 onto it (auto-merged the `AppRoutes.test.tsx` [41↔42] + `index.css` [42↔43] collisions, no conflicts).
  Fixed **one real integration bug** the Docker-free subagents couldn't catch (they don't run Playwright): slice-42's
  mic `aria-label="Record voice message"` collided with the chat composer under Playwright's substring
  `getByLabel('Message')` → made the chat-spec locator `{exact:true}`.
- **Verified (post-merge on `main`):** typecheck (5 pkgs) · lint 0 · **1354 Docker-free** (domain 133 · ui 43 ·
  application 404 · web 316 · api 458) · **`test:int` 43** (validates the prod Prisma VOICE binding + the v0.7
  migration under real Postgres) · **Playwright 20/20**. **BDD full-sweep = quiet-machine follow-up:** the local
  env kills cucumber mid-run (Node buffers its output → harness backgrounds it → env kills long background tasks;
  ~1 in 5 attempts completes). The last completed sweep was **215/217**, the 2 failures onboarding-401 flakes under
  CPU starvation (orthogonal — `run_results` can't reach auth; the same path is green in `auth.e2e` +
  `onboarding-rollback` on the migrated Postgres). The 3 slices are covered Docker-free by
  `billing.e2e`/`voice.e2e`/`runs.e2e` + Playwright + int. NOT pushed to `origin` / NOT deployed (pending owner).
- **Mobile app = CHARTERED, not built** (design doc §Mobile charter): Expo native, phased (Phase 1 = auth +
  dashboard), **"mirror" = feature/navigation parity NOT code reuse** (`@gilgamesh/domain` shared, `@gilgamesh/ui`
  React-DOM is not → new RN design-system), **Bearer-token auth** (`__Host-` cookies don't work native → kept OUT
  of this batch to preserve stream disjointness). Its own brainstorming → spec → plan cycle next.
- **Deferred:** BDD full-sweep 217/217 + capture-08/voice-composer screenshot checks (owner) on a quiet machine ·
  VoiceUsage metering · Reports N+1 batch endpoint · refund netting/line-item · everything prior unchanged.
