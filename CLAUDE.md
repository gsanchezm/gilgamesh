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

## Staging deploy (F0-F3) — BUILT + VALIDATED LOCALLY, F4 pending owner az login (2026-07-07, on `main`)

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
- **F4 (deploy):** blocked on owner — Azure CLI install + `az login` + Claude Console account
  (workspace `gilgamesh-staging` + spend limit; Claude Max does NOT back the product API). Runbook:
  spec §8 (two-phase, multi-tag, stopped-Postgres rules). Cost ~US$20-25/mo, Postgres stoppable.
