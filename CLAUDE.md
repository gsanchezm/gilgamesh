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
pnpm --filter @gilgamesh/api test:bdd          # Cucumber-js BDD acceptance vs API+Postgres (49 scenarios)
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

**Deferred (owner decision S1-B, see `docs/research/decisions-log.md`):** forgot/reset-password +
EmailPort (AC-AUTH-10/11/12 → slice 7); disabled Google/SSO login controls (AC-AUTH-15 → follow-up); the
logout UI control. **CI/quality gates wired + green** (`.github/workflows/`): `ci.yml` (ESLint
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
