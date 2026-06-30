# Gilgamesh — Decisions Log (living)

Records the product-owner's answers to the foundational questions. Source of authority over the
prototype where they conflict. Updated as answers arrive. Will be formalized into ADRs in Paso 2.

Owner: Gilberto (gilberto.aspros@gmail.com). Started 2026-06-29.

## Cross-cutting mandates (apply to every slice)
- **Performance is first-class** (set & enforce budgets in CI: API latency, runner concurrency, lazy/streamed UI, cached retrieval).
- **Security is primordial** (RBAC, strict per-`orgId` tenant isolation, secrets in vault, least privilege, signed expiring artifact URLs, SAST/deps/secrets/DAST in CI, audit log, target OWASP ASVS L2).
- **Multi-tenant SaaS for many companies** — cost-efficiency and isolation are design drivers everywhere.
- **Language = TypeScript** everywhere (preferred). **Package manager = `pnpm`** for installing all deps
  (pnpm workspaces + Turborepo). Confirmed by owner 2026-06-29. (Installs happen at scaffold/implement
  time — Paso 3 — not during the design/spec phase.)

## Answered

### 1. Canonical agent roster — DECIDED: **desktop prototype roster**
Zeus (lead), **Athena** (arch), **Anubis** (manual), Quetzalcóatl (web), **Iris** (api),
**Freya** (android), **Isis** (ios), **Thor** (perf), **Xochiquetzal** (visual), **Odin** (security),
**Ra** (accessibility). → Align mobile + design-doc to THIS roster (the doc/mobile names
Odín/Obatala/Indra/Pangu/Izanagi/Perún/Marduk/Viracocha are superseded).

### 2. Theme / language — CONFIRMED
Dark by default + light toggle available. **English-only, no i18n** — remove the ES/EN selector and the
`T()`/`setLang` machinery from the prototype. (Master-prompt locked decision wins over prototype.)

### 3. Slice 1 cut — CONFIRMED
Slice 1 = **Auth (local) + Onboarding (3 steps; creates Org + Project + optional repo) + Agent room**
(11 agents from DB; activo/ocupado/inactivo persisted; wake/sleep; KPIs). **Chat per-agent + voice → later slice.**

### 4. Test execution — DECIDED: **REAL execution from day 1** (no mock runner)
The `TestKernel` adapter talks to the **real `chaos-proxy`** (TOM kernel) over gRPC; no MockRunner stage.
> IMPLICATION (for Paso 2): the orchestration slice needs the kernel + ≥1 real plugin (e.g. Playwright)
> running in docker-compose, plus a sample System-Under-Test (e.g. OmniPizza) to execute against.
> We still keep `TestKernel` as a PORT (for testability/seams), but the default/only wired adapter is real.

### 5. TOM kernel integration — DECIDED: **consume it as a dependency** (port + gRPC adapter, no rewrite)
`packages/kernel` = `TestKernel` port + gRPC adapter to the author's `chaos-proxy`.
> NOTE from owner: he will create **additional repos that incrementally grow capabilities**; he'll loop us in
> when each is created so we review together. → Design `packages/kernel` + integrations to absorb new
> capability repos behind stable ports (open for extension, closed for modification).

### 6. Agent brain (LLM) — PENDING owner sign-off; **my recommendation given** (see below). Constraint: minimize cost at multi-tenant scale.

### 7. API framework / stack — DECIDED: **NestJS** (per my recommendation)
Reinforced mandate: **focus on performance and security** of the tool.

### 9. Multi-tenancy — CONFIRMED
**Org = root tenant** (strict isolation by `orgId`, row-level). Project under Org. **Agent = per-Org catalog**;
**ToolBinding per-Project**. No intermediate "Workspace" for now (YAGNI).

### 10. Auth — CONFIRMED
Local email/password (Argon2) + sessions for slice 1; **SSO/SAML + Entra ID** behind an `IdentityProvider` port (later adapter).

### 12. Dogfooding + CI — CONFIRMED
**Vitest** (unit), **Cucumber-js** (BDD/acceptance), **Playwright** (e2e UI). CI on **GitHub Actions** with
SDD/BDD/TDD + SAST/deps/secrets gates; **Azure Pipelines** parity later.

## Answered (continued)

### 8. Repo strategy — CONFIRMED: **hybrid (platform monorepo + capability polyrepo)**
- **Platform = single monorepo** (apps/web, apps/mobile, apps/api, apps/workers + packages/*), pnpm+Turborepo.
- **Capability engines = separate repos** (the TOM kernel + the future repos owner will add), consumed as
  versioned dependencies behind ports. This is the real multi-repo seam.
- Separation of concerns is enforced by **module boundaries + Clean Arch + import-boundary lint** (eslint
  boundaries / dependency-cruiser failing CI on cross-slice reach-in), NOT by repo walls. Monorepo keeps
  shared contracts (domain types, OpenAPI client, UI kit, kernel port, events) as one atomic source of truth.
- Reconsider splitting a specific app into its own repo ONLY for: independent deploy cadence, separate
  team ownership, or open-sourcing that app. Otherwise stay monorepo.

### 11. QA environment — CONFIRMED: **two-track**
- **Local docker-compose** (Postgres + Redis + MinIO + pgvector + chaos-proxy kernel + Playwright plugin +
  OmniPizza SUT) for fast TDD/BDD loops — the day-to-day QA env.
- **Azure QA environment** via IaC (Bicep) provisioned in the foundation: Container Apps (scale-to-zero/KEDA
  to keep idle cost ~0), Postgres Flexible, Blob, Service Bus, Key Vault. Single small QA env, no prod yet.
- CAVEATS: (a) I **cannot** run `az login` or enter cloud credentials — owner does the Azure subscription
  auth; I provide Bicep + one-command deploy. (b) Cost starts when deployed → owner decides WHEN to deploy.
- RESOLVED: **write the Bicep now (in foundation); deploy when owner says so** (no cloud cost until deploy).

## My recommendation for #6 (LLM cost-minimization at multi-tenant scale)
Provider-agnostic `AgentBrainPort`; default provider **Claude (Anthropic)**. Cost strategy:
1. **Model tiering** — route each task to the smallest adequate Claude tier (cheap/high-volume → Haiku;
   most authoring/planning → Sonnet; hard reasoning only → Opus). Escalate only on need.
2. **Prompt caching** for the large shared context (system prompts, ISTQB grounding) — big savings when
   many tenants share the same static preamble.
3. **Tight RAG retrieval** (pgvector) so prompts carry only relevant chunks, not whole docs.
4. **Batch API** for non-interactive bulk generation (e.g. mass case authoring) — substantially cheaper.
5. **Per-org usage metering + quotas** tied to billing (run-minutes/token budgets); cost attributable & capped per tenant.
6. **BYOK / pluggable provider** behind the port — a tenant can bring their own key or an OSS/self-hosted
   model for cost/compliance, without touching domain or UI.
> Exact model IDs + current prices to be pinned in Paso 2 using up-to-date data (not quoted from memory here).

## Paso 2 — Foundation APPROVED by owner (2026-06-29)
D-A/B/C resolved "va con tus recomendaciones":
- **D-A:** default LLM provider = **Claude (Anthropic)** confirmed. Embedding model pinned later at the
  RAG slice using current data (claude-api reference); KnowledgeChunk.embedding stays 1536 (configurable) for now.
- **D-B:** SSE transport = **Redis Streams locally**; **Azure Event Hubs** (replayable) in cloud.
- **D-C:** ship the same-org validation guard + CI `child.orgId==parent.orgId` test **now**; schedule
  composite FKs (`@@unique([orgId,id])` + `(orgId,parentId)`) **before GA**.
→ Proceeding to Paso 3 (slice 1: Auth + Onboarding + Agent room) under SDD→BDD→TDD.

## Paso 2 — Foundation status (2026-06-29) — APPROVED
Foundation authored from the frozen keystone (8 parallel agents) + adversarially hardened
(security: 14 findings; performance: 16 findings) — all applied as spec edits; keystone kept frozen.
Artifacts: ARCHITECTURE.md · specs/{_keystone,data-model,api,runtime,design-system,slices/01-*,infra} ·
packages/kernel/CONTRACT.md · infra/bicep/* · docs/conventions/*.

Decisions that still need the owner (do NOT block slice 1; needed for orchestration/RAG/cloud):
- **D-A (LLM/#6, still open):** confirm default provider = Claude + the EMBEDDING model → fixes
  KnowledgeChunk.embedding dimension (1536 assumed). Drives RAG.
- **D-B (SSE cloud transport):** Service Bus single-subscription is competing-consumer → breaks
  broadcast/replay. Choose: Azure Event Hubs OR per-replica SB subscriptions + DB snapshot OR Redis
  Streams via Azure Cache. Cost + complexity tradeoff. (Local docker-compose Redis Streams is fine now.)
- **D-C (tenancy hardening):** adopt composite FKs `@@unique([orgId,id])` + `(orgId,parentId)` now
  (heavier Prisma remodel) vs Layer-1 same-org validation + CI `child.orgId==parent.orgId` test until GA.
  Recommendation: ship the CI-test guard now, schedule composite FKs before GA.

## Paso 3 — Slice 1 close-out plan (2026-06-30) — DECIDED by owner

State at decision time (verified): typecheck clean (5 packages) + 93/93 unit/e2e green; 36/41 ACs
implemented; prod `main.ts`→Prisma DONE (`206ff25`); AC-AUTH-14 CSRF DONE (`16a8629`). In flight,
**uncommitted + unproven**: AC-AUTH-13 rate-limit guard (wired global APP_GUARD but no test exercises
the 429 branch — green only because tests set `AUTH_RATE_LIMIT=1000000`).

### S1-A. Close-out order — DECIDED: **AC-AUTH-13 (with test) first, then the client prod-breakers**
1. Finish AC-AUTH-13 the TDD way and commit it. 2. Fix the two client prod-breakers (CSRF
`X-CSRF-Token` double-submit in `onboarding-client`/`agents-client`; `GET /auth/me` session-restore on
mount). Then BDD-green vs Postgres → Playwright e2e → coverage backfill → PR.

### S1-B. Slice-1 scope — DECIDED: **close the built surface; defer forgot/reset + AC-AUTH-15**
Slice 1 = AUTH-01..09/14 + ONB-01..13 + ROOM-01..13 green in BDD + Playwright, with rate-limit proven
by a dedicated e2e. **AC-AUTH-10/11/12** (forgot/reset-password + EmailPort + reset-token store) →
**slice 7**. **AC-AUTH-15** (disabled Google/SSO UI controls) → follow-up (not green-blocking).

### S1-C. Rate-limit infrastructure — DECIDED: **Redis + native TTL now** (deviates from my "in-memory now" rec)
The slice-1 rate limiter moves to a **Redis-backed fixed-window store with native TTL eviction**, not the
in-memory `Map`. Consistent with existing infra (#11 local docker-compose Redis + D-B Redis Streams).
> IMPLICATION: introduce a `RateLimitStore` PORT (Clean Arch) with two adapters — **Redis** (prod +
> `test:int`/BDD against the compose Redis) and **in-memory** (Docker-free default unit/e2e, so the 429
> e2e and the rest of the suite stay runnable without Docker). The guard depends on the port, not on Redis
> directly. Also fixes the no-eviction leak; still need `trust proxy` set in `main.ts` so `req.ip` is the
> real client behind a balancer. Multi-replica correctness now follows from the shared Redis store.

## Paso 3 — Adversarial review of the close-out (2026-06-30) — fixed before PR

A multi-agent adversarial review (4 dimensions → verify → synthesize) of the close-out diff found real
defects the green suite missed. All confirmed must-fix items were fixed (TDD, regressions verified RED first)
and re-verified green (140 Docker-free + test:int 9 + BDD 49 + Playwright):
- **[HIGH] Rate-limit bypass via whitespace-padded email** — guard keyed on un-trimmed email while the auth
  use case trims; padded variants minted fresh buckets for one account. Guard now trims identically.
- **[HIGH] CSRF cookie session-scoped vs persistent session** — after a browser restart, `/auth/me` restored
  the session but the csrf cookie was gone → every mutation + logout 403. `/auth/me` now re-mints csrf; login
  gives csrf the session's maxAge.
- **[MED] Redis outage → generic 500** — guard now fails open on store error; `DomainExceptionFilter` is a
  catch-all so no unmapped error leaks Nest's default 500 (all responses stay problem+json).
- **[MED] In-flight `/auth/me` clobbered a completed sign-in** — `settle()` now applies only while booting.
- **[MED] `trust proxy` hardcoded** — now validated `TRUST_PROXY` config (default 1).
- Plus low nits: auth-aware `/`+`*` routing, hermetic rate-limit e2e, me() test assertions, resetAt slack.

**Deferred to follow-ups (low / out-of-scope, surfaced for owner decision):** `__Host-csrf` prefix on the
CSRF cookie (touches BDD/e2e harness; mitigates sibling-subdomain cookie injection); in-memory store
TTL eviction sweep (dev/test-only — prod uses Redis); deriving `RATE_LIMIT_STORE` from validated config; the
§10.2 per-IP-only bound + account-lockout (already deferred). Forgot/reset (slice 7) and AC-AUTH-15 (S1-B).

## Paso 4 — Slice 2 (Test Lab authoring) scope — DECIDED by owner (2026-06-30)

Slice 1 merged to `main` (github.com/gsanchezm/gilgamesh). Starting slice 2 SDD→BDD→TDD.
- **S2-A scope = Núcleo:** `Slice` + `Feature` (with **gherkin scenario parsing**) + `TestCase` CRUD, all
  tenant-scoped, RBAC, audited. **No bulk import**, **no execution**.
- **S2-B brain = now, behind a stub:** define/consume the keystone `AgentBrainPort` via a **deterministic
  stub** adapter to power `POST …/test-cases/generate` (offline, reproducible). The **real Claude adapter**
  (tiering, prompt caching, BYOK, token metering) is its own later **Brain slice** — not slice 2.
Spec authored at `specs/slices/02-test-lab-authoring/spec.md` (27 ACs: SLICE/FEAT/TC/GEN). Building on branch
`slice-2-test-lab-authoring`.

**Slice 2 adversarial review (2026-06-30) — fixed before merge.** A 24-agent review of the slice-2 diff found
8 real defects the green suite missed (the in-memory wiring never fails mid-op nor interleaves concurrency).
All fixed, TDD, re-verified green (typecheck · ~185 Docker-free · test:int 9 · BDD 69 · Playwright 2):
- **[HIGH·sec]** trailing-slash bypassed `RateLimitGuard` (`/auth/login/` un-throttled) — also defeated AC-GEN-04;
  guard now strips trailing slashes + keys on the full normalized path (generate buckets per project+IP).
- **[HIGH·integrity]** feature+scenario writes were non-transactional — extended the UnitOfWork `Repositories`
  bundle (features/scenarios/testCases) and wrapped Create/Update/DeleteFeature in `uow.transaction`.
- **[MED]** empty-string FK ids ('' → 500 on Postgres) → `|| null` normalization; Prisma P2002→409 / P2025→404
  mapping (key-gen race + save-after-delete no longer leak 500); `DeleteSlice` detaches dependents explicitly
  (no in-memory-vs-Postgres divergence); gherkin parser is doc-string-aware; GenerateDrafts caps output to count.
- **Deferred (follow-up):** generate throttle keyed post-auth per principal (current per-project key reduces the
  blast radius); deterministic ORDER BY on the Prisma list queries; a Prisma-wired testlab int test; an
  executable AC-GEN-04 429 assertion; `@IsUUID` DTO hardening for non-empty malformed ids.

**Slice 2 status — DONE (2026-06-30).** Built SDD→BDD→TDD across domain (gherkin parser), application (15 use
cases + 4 ports + DeterministicBrain stub), api (controllers + Prisma models/migration + both wirings), web
(TestLabClient + TestLabScreen). Green end-to-end: typecheck · ~182 Docker-free unit/e2e · test:int 9
(Postgres+Redis) · BDD 69 scenarios/539 steps · Playwright (smoke + Test Lab). Deferred per S2: bulk import,
the real Claude brain adapter (Brain slice), `__Host-csrf` + the CI quality-gate workflows (shared with the
slice-1 follow-ups). **Merged to `main` (FF, e22fad0) after the review fixes; slice-2 review follow-ups landed
on main: a Prisma-wired testlab int test + a domain architecture fitness function.**

## Paso 5 — Slice 3 scope (Test Execution + Results) — owner decision S3 (2026-06-30)

Owner picked the **Test execution + results** vertical for slice 3. **Keystone §7 caveat surfaced:** the
Orchestration/Reports-from-real-runs slice is `BLOCKED-UNTIL-DELIVERED` (real runs need the owner's
chaos-proxy/TOM kernel, decision #5), and the full keystone execution model is async (enqueue → BullMQ
workers → `TestKernel.run` streaming `RunEvent` → `RunNode` DAG → `Artifact` → SSE).

**Decision S3 — build the execution shell behind a deterministic `TestKernel` stub now** (the Brain-stub
pattern of slice 2), taking §7's *"everything else proceeds NOW behind the `TestKernel` port"* path, as a
**synchronous núcleo**:
- **In:** `Run` + `RunStatus` (keystone verbatim) · `TestKernel` port + `DeterministicKernel` stub (offline,
  reproducible) · `TriggerRun` (sync execute of a Feature/TestCase) → `Run` + per-scenario `RunResult`s +
  counts/`durationMs` · `POST /projects/{id}/runs` + `GET /projects/{id}/runs` + `GET /runs/{id}` · results UI ·
  reflect latest result onto `Scenario.lastStatus`/`TestCase.status` · UoW-atomic · tenant isolation + RBAC.
- **Deferred (Orchestration slice, when chaos-proxy lands):** real `chaos-proxy`/`AgentPlugin` execution, SSE
  `/runs/{id}/events`, BullMQ workers, `RunNode`/DAG canvas, `Artifact`/reports, `/cancel`, `RunMode`/stages.

Spec at `specs/slices/03-test-execution/spec.md` (12 ACs: AC-RUN-01..12). Building on `slice-3-test-execution`.

**Slice 3 status — DONE (2026-06-30).** Built SDD→BDD→TDD across domain (`summarizeRun`), application
(`TestKernel` port + `DeterministicKernel` stub + `TriggerRun`/`ListRuns`/`GetRun`, UoW-atomic), api (`RunsModule`
+ Prisma `Run`/`RunResult` models/migration + both wirings), web (`RunsClient` + Run button + results panel).
Green end-to-end: typecheck · ~216 Docker-free unit/e2e · test:int 10 · BDD 75 scenarios/592 steps · Playwright
(smoke + Test Lab + run flow). Deferred per S3 (Orchestration slice, when chaos-proxy lands): real execution,
SSE `/events`, BullMQ workers, `RunNode`/DAG canvas, `Artifact`/reports, `/cancel`. Awaiting owner review/merge.

**Slice 3 adversarial review (2026-06-30) — fixed before merge.** A 20-agent review found 2 real defects + 2
nits the green suite missed (the in-memory wiring is single-threaded). Fixed, re-verified green (typecheck ·
application 71 · api 62 · test:int 10 · BDD 75):
- **[HIGH]** TriggerRun's FEATURE reflection rewrote the scenario set from a pre-kernel snapshot via
  `replaceForFeature` (delete-all+insert) inside the tx → a feature edit committing during the run's I/O window
  was clobbered (lost update). Now reflects via `ScenarioRepository.setLastStatus` (in-place per-row update by
  id inside the tx, no-op if concurrently deleted).
- **[MED]** malformed `targetId`/`runId` (non-UUID) → Prisma P2023 → generic 500; now mapped to 404 in the filter.
- **[nit]** deterministic newest-first run order (`id desc` tiebreaker) + a real 2-run e2e assertion (was a
  single-run false-green).
- **Deferred (follow-up):** rate-limit/quota on the run trigger (`runMinutesQuota` enforcement → billing slice).
