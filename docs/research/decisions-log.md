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

## Paso 6 — Quality consolidation (post-slice-3, 2026-06-30)

After the 3 slices landed on `main`, a consolidation pass (no new product scope) wired the CI/quality gates the
methodology mandates and closed the cheap review follow-ups:
- **Architecture fitness tests** (domain + application): dependency-free SAST-style guards that fail if either
  layer imports a framework/outer ring (Clean Architecture's dependency rule).
- **Deterministic ORDER BY** on the Prisma list queries (runs, features, test-cases) — closed an in-memory↔Prisma
  parity gap + a false-green.
- **CI pipeline** (`.github/workflows/ci.yml`, green): typecheck + Docker-free tests · integration + BDD on
  Postgres/Redis services · Playwright.
- **SAST** (`.github/workflows/codeql.yml`, CodeQL security-extended, green) — immediately caught **2 HIGH
  `js/polynomial-redos`** in the gherkin parser (regex over ≤256 KB user input → DoS); rewritten to linear
  string ops. Also caught + fixed CI workflow hardening (least-privilege `permissions`, pinned 3rd-party action).
  **0 open code-scanning alerts.**
- **Dependabot** (`.github/dependabot.yml`): weekly npm + github-actions update PRs (keeps deps + pinned actions
  fresh).
- **Remaining gates (follow-up):** lint/import-boundaries (ESLint), secret-scan (gitleaks), bundle-size, k6
  perf, contract tests.

## Paso 7 — Slice 4 scope (Subscription & Billing) — owner decision S4 (2026-06-30)

Owner picked **Subscription / billing** as slice 4. The keystone `PaymentProvider` port is "MOCK now; Stripe
later — no UI/domain change". **Decision S4: wire a deterministic `MockPaymentProvider` stub now** (the
Brain/Kernel-stub pattern), offline/no-network/no-Stripe. **In:** view subscription + usage · change
plan/cycle (remaps `runMinutesQuota` + seat max per §9 pricing) · update seats · checkout (mock) + confirm ·
cancel · **enforce `runMinutesQuota` on `TriggerRun`** (closes the slice-3 deferred follow-up; charge +
run-write atomic). **Deferred:** real Stripe, `Invoice`/`listInvoices`, webhooks/`handleWebhook`, proration/
payment-methods/dunning. Spec at `specs/slices/04-subscription-billing/spec.md` (12 ACs AC-SUB-01..12).
Building on `slice-4-subscription-billing`.

**Slice 4 status — DONE (2026-06-30).** Built SDD→BDD→TDD across domain (planLimits/priceCents), application
(PaymentProvider port + MockPaymentProvider + 5 use cases + run-minute quota enforcement on TriggerRun), api
(BillingModule + both wirings + QUOTA_EXCEEDED→402; no migration — Subscription exists), web (BillingClient +
BillingScreen at /billing). Green: typecheck + lint · ~281 Docker-free · test:int 10 · BDD 82 scenarios/648
steps · Playwright (smoke + Test Lab + run + billing). Closed the slice-3 deferred run-minute quota. Deferred
per S4: real Stripe, Invoice/listInvoices, webhooks/handleWebhook. Awaiting owner review/merge.

**Slice 4 adversarial review (2026-06-30) — fixed before merge.** An 18-agent review found a CRITICAL
concurrency defect + 2 HIGH + 3 nits. Fixed, re-verified green (domain 43 · application 113 · api 68 · int 10
· BDD 84 · web 49; typecheck+lint):
- **[CRITICAL]** TriggerRun charged the quota by writing the whole pre-tx subscription row back, so a
  concurrent ConfirmCheckout/plan/seat/cancel was silently reverted, and two concurrent runs bypassed the
  quota (lost charge). Replaced with `SubscriptionRepository.chargeRunMinutes` — an atomic conditional
  increment (Prisma raw `UPDATE … WHERE used+cost <= quota`) that touches only the counter and rolls back
  the run on a `false`. (Same lost-update class slice 3 fixed for scenarios; the subscription charge regressed.)
- **[latent]** ENTERPRISE quota was `MAX_SAFE_INTEGER` → int4 overflow on Postgres; now 1e9.
- ENTERPRISE is no longer a free self-service upgrade (contact-sales); `currentPeriodEnd` derives from the cycle.
- **[coverage]** added Postgres+HTTP BDD `@AC-SUB-07` scenarios (charge + 402) — catches the prior 402→500
  false-green that the green suite missed.
- **Deferred (follow-up):** optimistic-lock/version column for concurrent admin-vs-admin subscription
  mutations (run-vs-admin is fixed); CANCELED-status run gating (cancellation policy is an owner call).

## Paso 8 — Slice 5 scope (Knowledge / RAG) — owner decisions S5 (2026-06-30)

Owner picked **Knowledge / RAG** as slice 5. Provided a `rag/` corpus (24 QA docs — full ISTQB syllabi +
BDD books, pre-chunked into `rag/chunks/chunks.jsonl`, 2,647 chunks). A 25-agent corpus analysis mapped it
(BDD methodology · ISTQB foundation/advanced/management/specialist/AI · Principles&Patterns) and flagged:
43% of chunks carry page-furniture boilerplate (mandatory scrub), Gherkin/code corrupted by PDF conversion,
images lost, governance-prose over-representation, and **this is GLOBAL shared knowledge, not per-tenant**.
Owner answers:
- **S5-A — Global shared KB:** ingest the corpus as a GLOBAL collection (no `orgId`) grounding all orgs;
  per-org private `KnowledgeDoc` uploads are a fast-follow.
- **S5-B — Deterministic stub embeddings:** a lexical-hash embedder (bag-of-words → 1536-dim L2-norm) behind
  `AgentBrainPort.embed` (distinct texts → distinct vectors → lexical similarity); real semantic embeddings
  land with the Brain slice.
- **S5-C — Wire the grounding seam now:** a `KnowledgeRetrievalPort` that `GenerateDrafts` consults (top-k →
  brain prompt + citations on the output).
- **S5-D — Licensing sign-off (owner-approved):** internal **retrieval-grounding** of the copyrighted corpus
  (ISTQB syllabi + commercial BDD books) is acceptable — the model reads chunks to reason, every chunk carries
  source+section **citations** that flow to the output, the embedding store is **private/non-redistributable**,
  and **verbatim text is never re-published without attribution**.

Spec at `specs/slices/05-knowledge-rag/spec.md` (AC-KB-01..10). Building on `slice-5-knowledge-rag`.

**Slice 5 status — DONE (2026-06-30).** Built SDD→BDD→TDD across domain (scrubChunk/embedText/cosineSimilarity),
application (KnowledgeChunkRepository + KnowledgeRetrievalPort + IngestKnowledge/SearchKnowledge/KnowledgeRetriever
+ GenerateDrafts grounding with citations), api (pgvector KnowledgeChunk + migration + raw-SQL adapter +
KnowledgeModule + GET /knowledge/search + KnowledgeSeeder + scripts/ingest-corpus.mjs), web (KnowledgeClient +
KnowledgeScreen at /knowledge). Green: typecheck + lint · ~304 Docker-free · test:int 12 (pgvector) · BDD 88
scenarios/694 steps · Playwright (smoke + Test Lab + run + billing + knowledge). Full corpus (2,647 chunks)
ingested into the demo KB. Deferred: per-org private KnowledgeDoc uploads + ArtifactStorage; real semantic
embeddings (Brain slice); a document chunker; advanced retrieval (MMR/diversity, per-source caps). Awaiting
owner review/merge.

**Slice 5 adversarial review (2026-06-30) — fixed before merge.** A 16-agent review found 1 HIGH + 1 MEDIUM +
1 LOW, all at the in-memory-fake-vs-pgvector boundary (which the green suite structurally couldn't see).
Fixed, re-verified green (domain 49 · application 122 · api 72 · web 55 · int 14 · BDD 88 · Playwright 5):
- **[HIGH]** a tokenless query ("!!!", punctuation/CJK-only) embeds to an all-zero vector → in-memory cosine
  returns 0 but pgvector's `<=>` returns NaN → `score:null` over the wire → `KnowledgeScreen`'s `toFixed`
  crashed. SearchKnowledge + KnowledgeRetriever now short-circuit a zero-norm query embedding to empty results
  (both wirings agree); KnowledgeScreen guards with `Number.isFinite`.
- **[MEDIUM]** `search()` had no `ORDER BY` tiebreak → tied cosine distances made top-k non-deterministic +
  divergent from the stable in-memory adapter (AC-KB-05/09/10). Added `, id` to the Prisma `ORDER BY` + an id
  tiebreak to the in-memory sort.
- **[LOW]** `scrubChunk` ran the `[^\n]*`-anchored copyright regex before `<br>`→newline (latent over-reach,
  0 impact on the shipped corpus); reordered. Correctly excluded as non-findings: the missing `orgId` (intended
  global KB) and the lexical-hash stub (intended until the Brain slice).

## Paso 9 — Slice 6 scope (Integrations) — owner decisions S6 (2026-06-30)

Owner picked **Integrations (connect a Git repo)** as slice 6. Scope = SOURCE_REPOS only. Decisions (advisor-reviewed):
- **S6-A — Deterministic stub `RepoProvider` [S6-NEW port]** (verify/listRepos/listFeatureFiles), offline.
  Real OAuth/webhooks + the other integration groups (tracking/comms/ci/devices) deferred.
- **S6-B — Secret hygiene:** the raw token is NEVER persisted/logged/returned/audited — only a synthetic
  `secretRef` (`vault://{orgId}/{key}`). The stub verifies then discards the token via `SecretVault.put`
  [S6-NEW port] (no `get()`). Mirrors GenerateDrafts' "never store the raw prompt".
- **S6-C — Keystone-aligned surface + one explicit extension:** connect/disconnect/config all route through
  the single keystone mutator `PATCH /orgs/{orgId}/integrations/{key}` (intent in body). Repo feature import is
  **[S6-NEW]** `POST /projects/{id}/repo/import` (recorded as an explicit extension, not a silent path).
- **S6-D — Lifecycle = upsert-on-PATCH:** org starts with zero Integration rows; List merges the static
  SOURCE_REPOS catalog against connected rows; PATCH connect upserts. No change to CompleteOnboarding.
- **Enum map:** `Integration.key` `ado_repos` → `Project.repoProvider` `ado` (different value sets).
- **Import idempotency:** upsert Features by path; resolve the integration by `project.orgId` (never client org).

Spec at `specs/slices/06-integrations/spec.md` (AC-INT-01..09). Building on `slice-6-integrations`.

**Slice 6 status — DONE (2026-06-30).** Built SDD→BDD→TDD across domain (SOURCE_REPO_CATALOG +
repoProviderForKey), application (Integration record + RepoProvider/SecretVault/IntegrationRepository ports +
MockRepoProvider/StubSecretVault + ListIntegrations/ConnectIntegration/DisconnectIntegration/ImportRepoFeatures;
ProjectRecord gains repoLastSyncAt + ProjectRepository.save), api (Prisma Integration + IntegrationGroup +
migration with projects.repo_last_sync_at + PrismaIntegrationRepository + IntegrationsModule: GET
/orgs/:orgId/integrations + PATCH /orgs/:orgId/integrations/:key + [S6-NEW] POST /projects/:id/repo/import), web
(IntegrationsClient + IntegrationsScreen at /integrations + Test Lab import control). Green: typecheck + lint ·
~340 Docker-free · test:int 14 · BDD 94 scenarios/738 steps · Playwright (smoke + Test Lab + run + billing +
knowledge + integrations). Secret hygiene verified: the raw token never appears in any view/list/audit/row.
Deferred: real provider OAuth/webhooks/sync; the non-SOURCE_REPOS groups; a real Key Vault with get(). Awaiting
owner review/merge.

**Slice 6 adversarial review (2026-06-30) — fixed before merge.** A 14-agent review confirmed the S6-B token
invariant HOLDS (no raw-token leak in any wiring) and found 1 HIGH + nits, all fixed + re-verified green
(application 135 · api 80 · int 14 · BDD 94 · Playwright 6):
- **[HIGH]** concurrent/double-submit repo import created duplicate Features (existence read outside the tx +
  no DB uniqueness on path). Added `@@unique([projectId, path])` (+ migration) + a `FeatureRepository.upsertByPath`
  (atomic create-or-update keyed on the path, preserving id/sliceId/createdAt); ImportRepoFeatures upserts in-tx
  → idempotent AND concurrency-safe.
- **[latent]** the import wrote a full project row from the stale pre-tx snapshot (slice-4 lost-update class) →
  added `ProjectRepository.linkRepo` (targeted repo-column update) and the import uses it.
- `listForOrg` now orders by key (deterministic "first connected"); dropped the unused `config` DTO field;
  added a Postgres-level BDD guard asserting no token in the row/audit + `secretRef == vault://{orgId}/{key}`.

## Slice 7 (Look & feel) — session decisions (2026-07-01)

Working `feat/look-and-feel`, UI + functionality in parallel, ~100% faithful to `capturas/`, porting the
prototype. Owner decisions this session:
- **View order** = flow + backend-first: **Onboarding(register) → Pricing → backend re-skins (Knowledge,
  Test Lab, Integrations, Subscription) → heavy new views (Orchestration, Chat, Reports, Session)**.
- **"Functionality a la par" for backend-less views = REAL backend** (not mock-seam) via SDD→BDD→TDD slices.
  Caveat surfaced (not blocking; those views are last): **Orchestration** real backend is blocked on the
  TOM/chaos-proxy kernel (§7 `BLOCKED-UNTIL-DELIVERED`), **Chat+voice** on the real Brain/Claude adapter
  (deferred); **Reports** + **Session-replay** are partially doable now over slice-3 `Run`/`RunResult`
  (Session-replay needs per-action timeline data slice-3 doesn't persist yet).
- **Review cadence** = **per-view screenshot** (build a view fully, screenshot dark[/light], owner approves
  before the next). Self-check each view with an adversarial screenshot-vs-capture diff before showing.

**Phase 5 — Register ("Create account", capture 02-registro) — DONE, owner-approved (2026-07-01).**
The web signup, twin of Login. Extracted shared `AuthHero` (helix canvas + brand) from Login (byte-identical);
`RegisterScreen` (First/Middle/Last/Company/email/password+confirm; client validation password ≥ 12 & match)
→ real `POST /auth/register` (auto-signs-in; NO CSRF — register establishes the session; the Org is NOT
created here, spec AC-AUTH-01). Route `/register` wired (+ a `/pricing` placeholder for Phase 6); **Company**
carried to onboarding via router state (→ future `orgName`, fixing the `orgName = projectName` shortcut).
Shared `.gx-auth` layout reworked to the prototype's flex model (hero `flex:1` + fixed 520px right column)
after an adversarial fidelity diff flagged the scaling-grid composition — improved Login too, no regression.
Verified green: web 75 unit · typecheck + lint · Playwright register 4 + smoke. **Follow-on (separate commit,
no capture):** re-skin the project onboarding wizard (port the prototype's `isOnboarding`) consuming the
carried company as `orgName`.

**NEW pricing / business model (owner, 2026-07-01) — authoritative, SUPERSEDES the slice-4 billing model.**
Billing unit = **active workspaces / month** (not seats/projects/executions). **4 tiers:** FREE $0 (1 ws · 2
services · 500 exec) · STARTER $29 (unltd ws · 5 svc · 5k exec · 3 users) · GROWTH $99 (15 svc · 25k exec ·
unltd users) · SCALE $499 base incl 10 ws + $99/extra ws (unltd exec/svc, SSO, RBAC, SLA). Annual = 2 months
free. Anti-abuse = per-ws service + execution limits. Positioning: "the Stripe of testing" / "the only testing
platform built on a peer-reviewed mathematical model." Full detail in the auto-memory `gilgamesh-pricing.md`.
**IMPLICATION:** this supersedes the slice-4 billing domain (`planLimits`/`priceCents`, `PlanTier`
TEAM/PRO/ENTERPRISE, per-seat, `runMinutesQuota`) and the `03-pricing` capture's 3 old tiers. **Phase 6 Pricing
page ports the capture's LAYOUT but renders these 4 NEW tiers from a canonical plan catalog.** Migrating the
billing/subscription backend + the `/billing` screen to this model is its own follow-up slice (flagged to owner).

## Audit remediation — owner decisions (2026-07-01)

The pasted codebase audit was re-run against `feat/look-and-feel`, so it re-flagged items already fixed on the
divergent `refactor/audit-hardening` branch. Reconciled + executed SDD/TDD, all green. Decisions:
- **Branch strategy — DECIDED:** merge **Batch A → `main`** (independent, contract-stable — done + pushed
  `2cca0de..328d5fc`) and fix **#1/#2 on `feat/look-and-feel`** since that knowledge-document code only exists
  there. Rejected cherry-picking Batch A into look&feel (duplicates work / risks later conflicts).
- **Batch B placement — DECIDED: ride look&feel.** `#6`/`#7`/`#10` are contract-stable but were built on
  look&feel; `#10` is entangled with slice-7's per-org knowledge schema (writes `org_id`/`document_id`, columns
  absent on `main`) so it cannot be decoupled; `#6`/`#7` are low-urgency → not worth a separate off-`main`
  branch. All reach `main` when look&feel merges. `refactor/audit-hardening` is now redundant (safe to delete).
- **Delivered on `feat/look-and-feel`:** `#1`/`#2` atomic knowledge upload (`UnitOfWork`, document-first) + chunk
  FKs/indexes + orphan purge (`89d5ca2`); `#6` `countByFeature` (no N+1), `#7` TC-key retry-on-`CONFLICT`
  (`P2002`→`CONFLICT`), `#10` batch `upsertMany` via `Prisma.join` (`3130c12`); `R2` shared `apps/web/src/lib/http.ts`
  (`e6beb7c`). Verified 409 Docker-free · `test:int` 19 · BDD 94 · typecheck · lint.
- **Bloque 3 — PENDING owner decision** (behavior/contract/infra, not auto-started): rate-limit fail-open policy ·
  per-IP backoff (own slice) · pagination (own slice) · RAG final posture · optimize heavy assets (E5) · pin
  GitHub Actions to SHA. Tracking: `audit-followup.md` · board: `feature-status.md`.

## Slice 8 (Agent Chat, text) — owner decisions + review (2026-07-05)

- **Keystone v0.2 approved** and applied **in series on `main` (`933769d`) before the worktree** (plan
  rule 2): +`ChatSession`/`ChatMessage` (§2) · +`ChatMessageRole`/`KnowledgeScope` (§1) ·
  `KnowledgeChunk.scope?` indexed (§2) · 3 chat routes (§6) · chat repositories (§5) · new §10 changelog.
- **Decision S8:** wire `AgentBrainPort` to the extended `DeterministicBrain` (canned per-slot answers +
  keyword classify — the Billing mock pattern). The slice is NOT blocked on the real Claude adapter or
  chaos-proxy; real answers + live SSE push = the Brain slice.
- **Owner: "review + merge direct to main."** The protocol's HUMAN_REQUIRED gate was satisfied by an
  8-angle adversarial review (line-by-line, removed-behavior, cross-file, reuse, simplification,
  efficiency, altitude, conventions/keystone) + verification; merged FF `a3b7284`; post-merge re-test
  green (504 Docker-free).
- **Review S8 — FIXED (TDD red→green):** stub dispatches on caller intent — RAG grounding containing
  `(slot: <key>` could silently flip `GenerateDrafts` to zero drafts, and a chat message that is
  `{"classify"}` JSON was answered with router JSON · C2 201 view carries `runId` in both wirings
  (in-memory mutation ≠ Prisma `updateMany`) · `GET /chat/:id/events` is MEMBER+ (a VIEWER could read
  whole conversations) · chat throttle POST-only + suffix-bucketed (fresh sessions minted fresh buckets)
  · tool args capped at the direct endpoints' DTO limits (title 256 / prompt 2000) · failing authoring
  tools narrate instead of 4xx-ing after the USER message persisted · every whitelisted tool attempt is
  audited with outcome · ChatModule injects the canonical `TriggerRun`/`CreateTestCase`/`GenerateDrafts`
  (now exported by RunsModule/TestLabModule) · shared `formatGrounding` + single retriever pipeline.
- **Review S8 — DEFERRED (follow-ups):** reusable SSE adapter (runs will need the same transport) ·
  first-class tool registry (schema-validated; required for real Brain `tool_use`) ·
  `FeatureRepository.findByName` (avoid the per-tool-call full scan) · web appends the answer instead of
  re-fetching the whole replay (O(n²) over a session) · `agent_id` FKs on chat tables · dedupe the
  acceptance `server()` helper (6th copy) · unify the SSE `at` vs `createdAt` wire shape ·
  `isKnowledgeScope` stays unused until a scope-input surface exists.

## Slice 9 (Brain) — owner decisions + review (2026-07-06)

- **Keystone v0.3 approved** ("Apruebo") and applied in series on `main` (`214f94b`) before the worktree:
  `AI_PROVIDERS`+`anthropic`, `BrainSurface`, `BrainUsage`, `GET /orgs/{orgId}/brain/usage`.
- **Owner decisions S9-1..6** (recorded in the spec §0): platform env key + optional per-org BYOK w/
  stub fallback and `BRAIN_MODE=offline` forcing; embeddings stay lexical (Anthropic has NO embeddings
  API — semantic = separate Voyage-class decision); metering without charging; first-class tool registry;
  live SSE via the frozen EventBus; tier→model/config in the adapter. Implementation amendment: metering
  is UNCONDITIONAL (stub included) — the `BRAIN_METER_STUB` knob was dropped as needless config.
- **Review S9 (3 angles: line-by-line infra, cross-file/DI, conventions/secrets)** — secrets gate CLEAN
  (key never in logs/errors/rows/audit/views), DI/cross-file CLEAN. Fixed from line-by-line: SSE
  lifecycle (leaked subscription+heartbeat on disconnect race; replay/subscribe event gap; unguarded
  writes; Accept-sniffing → explicit `?live=1`), cache-token usage silently dropped (now captured
  end-to-end), undrained retry response bodies, verifier 4xx mapping. Deferred: org-BYOK call-time
  resolution (needs `SecretVault.get()`); live EventSource in the web chat; web chat O(n²) replay
  (unchanged from S8); `BRAIN_SMOKE` manual smoke.


## Programa paralelo de 5 streams (2026-07-06) — owner decisions + resultado

- **Keystone v0.4 aprobado** y aplicado en serie (`ea888d1`): rutas de lectura del chat
  (`GET /projects/{id}/chat` list + `GET /chat/{sessionId}/messages`) + `PasswordReset` + `EmailPort`.
- **Owner: hasta 5 worktrees en paralelo; anunciar siempre qué worktrees/CLIs se usan** (regla
  permanente). Asignación por matriz: agy→billing, codex→chat-reskin, claude→resto. El clasificador
  de permisos bloqueó los modos no-interactivos de agy/codex (flags que desactivan sus gates);
  reglas escritas en `.claude/settings.local.json` (gitignoreado) pero la sesión no las recargó —
  **owner decidió: fallback a subagentes Claude** para billing y chat-reskin.
- **Resultado (todo merged + pushed a `main`):** CI hardening (14 actions a SHA + −972 KB assets
  lossless) · BYOK call-time (`SecretVault.get` + `forOrg(orgId)`, cache orgId+secretRef) ·
  **S12 auth recovery** (202 genérico anti-enumeración, token sha256-only 30min single-use consumido
  antes del rewrite, reset revoca sesiones; BDD 141) · **S10 billing 4-tier** (hallazgo honesto: la
  semántica ya vivía desde `7632020`; el slice formalizó spec+BDD y derivó domain de `PLAN_CATALOG`
  como fuente única + pines de precio; BDD 148) · **S11 chat re-skin** (rail+historial v0.4, título
  derivado del primer mensaje, `ProjectAgentView.id` + deep-link pinned, EventSource vivo que
  reemplaza el replay O(n²) de S8; BDD 160/1318 · Playwright 18 · screenshot vs captura 07
  **aprobado por el owner**). Fusion points (AppRoutes.test, wiring Prisma) resueltos conservando
  ambos lados en merges secuenciales con re-test.
- **Deferred vigente:** voz (STT/TTS) · "View session" (bloqueado por timeline) · Log out (S1) ·
  Stripe/Invoice/webhooks · cobro de tokens del Brain · embeddings semánticos (Voyage) ·
  Orchestration/Session (TOM chaos-proxy) · SSO (AC-AUTH-15) · Bloque 3 restante (fail-open del
  rate-limit, per-IP backoff, pagination, postura RAG).


## Programa paralelo v2 — Stripe + SSO + Embeddings + Email + Logout (2026-07-06) — owner decisions

- **Combo aprobado (recomendaciones aceptadas en bloque):** 5 streams en worktrees disjuntos —
  `slice-13-stripe` · `slice-15-sso` · `feat-semantic-embeddings` · `feat-email-adapter` ·
  `feat-logout-ui`. **Cobro de tokens del Brain = SECUENCIAL tras Stripe** (chocan en billing), NO
  entra en este combo.
- **Keystone v0.5 aprobado** y aplicado en serie sobre `main` ANTES de paralelizar: +`Invoice`/
  `InvoiceStatus` + `GET /orgs/{orgId}/invoices` + `POST /billing/webhooks/{provider}` + rutas SSO
  `GET /auth/sso/{provider}/start|callback` + **BREAKING owner-approved:** `KnowledgeChunk.embedding`
  vector(1536)→vector(1024) (Voyage 4 no ofrece 1536; migración destructiva + re-ingesta del corpus).
- **S13 Stripe:** SDK oficial `stripe` (npm, server-only, pineado); patrón SelectingBrain — sin
  `STRIPE_SECRET_KEY` (o `PAYMENTS_MODE=offline`) → `MockPaymentProvider`; TODOS los suites/CI offline.
  Checkout Session real + webhooks con verificación de firma (raw body) + persistencia de `Invoice`.
- **Embeddings:** proveedor **Voyage `voyage-4`** (dim 1024, contexto 32K, `input_type`
  query/document), key de plataforma por env `VOYAGE_API_KEY`; BYOK Voyage = follow-up (§8 sin tocar).
  Offline/CI: hash léxico determinista actual recortado a 1024. Seam: `AgentBrainPort.embed` vía el
  brain selector; metering `BrainUsage` surface EMBED.
- **S15 SSO:** Google OIDC (code flow + PKCE + state/nonce) detrás del puerto congelado
  `IdentityProvider`; env `GOOGLE_CLIENT_ID/SECRET` (sin credenciales → botón deshabilitado);
  **login-or-register**: email verificado existente → link + sesión; nuevo → crea User (password
  inutilizable, hash de secreto aleatorio — passwordHash NO se vuelve nullable) → onboarding.
- **Email real:** adapter SMTP (nodemailer) detrás del `EmailPort` congelado; selección por env
  (`SMTP_URL`; sin URL o `EMAIL_MODE=offline` → stub actual que registra en memoria). Solo infra api.
- **Logout UI:** cierra el deferral S1 — control en Sidebar/Topbar → `POST /auth/logout` (existe
  desde S1) → limpiar estado de sesión del SPA → redirect `/login`.
- **Reglas de ejecución:** SDD→BDD→TDD por stream · gates de stack (int/BDD/Playwright) serializados,
  un worktree a la vez · merges secuenciales con re-test · review adversarial antes de cada merge ·
  worktrees SIEMPRE anunciados · fusion points esperados: `AppRoutes.tsx(.test)` (logout/SSO),
  `LoginScreen` (SSO), wirings de persistencia (Stripe/Invoice), `index.css` (regiones por stream).

### Resultado del programa v2 (2026-07-06 PM) — TODO merged en `main`

- **Integración secuencial** (FF, gates serializados por worktree): S18 logout → S17 email → S16
  embeddings → S15 SSO → S13 Stripe. **Post-merge: typecheck · lint · 801 Docker-free (domain 104 ·
  application 300 · ui 25 · api 224 · web 148) · int 19 · BDD 182/1517 · Playwright 18.** Corpus RAG
  re-ingerido (2,657 chunks léxicos 1024) tras la migración destructiva; worktrees eliminados.
- **Hallazgo honesto S18:** el control de logout YA existía end-to-end (shell slice-7) — los docs
  estaban stale; el slice quedó como verificación + cobertura (4 tests + logout.spec). Notas stale
  corregidas en CLAUDE.md (S1-B y delta S11).
- **Desviación de seguridad aceptada (S15):** config ausente ≠ stub (sería bypass de auth) — stub
  solo con `SSO_MODE=offline` explícito y rehusado bajo `NODE_ENV=production`.
- **Fusion points reales:** pines offline en los 4 harnesses (BRAIN/SSO/EMAIL/PAYMENTS_MODE) ·
  imports de ambos wirings de persistencia · `infra/index.ts` · lockfile (stripe+jose+nodemailer) —
  todos resueltos conservando ambos lados.
- **Lecciones de proceso (nuevas):** (1) los gates de stack requieren SERVIDORES FRESCOS — Playwright
  `reuseExistingServer` reutiliza silenciosamente el api/vite stale de otro worktree (matar
  3001/5173 primero); así se detectó que el "verde" de S15 en browser corrió contra la app de S16 —
  cubierto porque el árbol final (S13) re-corrió la suite completa. (2) `test:int`/`test:bdd` NO
  aplican migraciones — `db:deploy` manual antes del gate. (3) Un run matado a mitad de BDD puede
  dejar estado que hace fallar el siguiente sweep una vez (pasó 2/2 después). (4) Flake Playwright
  observado 1 vez en chat.spec (timing SSE de narración); el BDD cubre ese camino determinísticamente.

## Programa paralelo v3 (2026-07-06 PM3) — decisiones del owner

- **Tanda aprobada (5 streams, worktrees `pnpm wt`):** A `slice-14-token-billing` (S14 cobro de
  tokens Brain) · B `feat-voyage-byok` (Voyage BYOK + smoke) · C `feat-sso-redis-state` (Redis
  `SsoStateStore`) · D `feat-secret-vault` (vault real Azure Key Vault) · E `feat-vitest-3`
  (upgrade toolchain Vitest 3). Descartados de la tanda: Stripe portal/refunds (chocaría con A en
  billing), voz STT/TTS (necesita brainstorm de proveedor), Bloque 3 (sigue pendiente de decisión).
- **S14 — semántica de cobro:** quota incluida por plan + bloqueo `QUOTA_EXCEEDED` (patrón
  run-minutes; overage de pago DIFERIDO). Billable = `inputTokens + outputTokens` (cache read/create
  EXCLUIDOS — optimización que no se castiga). Cuentan TODAS las surfaces org-atribuidas
  (CHAT/ROUTER/GENERATE/EMBED); el ingest del corpus global sigue sin meterear. En superficies de
  chat el bloqueo se narra in-chat (nunca 500); en API → 402. Reset por periodo de billing (mismo
  rollover que executions).
- **Keystone v0.6 aprobado** (revisado por el owner ANTES del commit): +`voyage` (§8) ·
  `Subscription.brainTokensQuota/Used` (§2) · allowances §9 (FREE 100k · STARTER 2M · GROWTH 10M ·
  SCALE unlimited) · nota stale de Subscription corregida.
- **Agentes:** el owner pidió intentar CLIs externos; el experimento se agotó el mismo día:
  (1) agy solo edita con `--dangerously-skip-permissions` → denegado por el clasificador de
  auto-mode; owner redirigió B/D a codex. (2) codex `exec -s workspace-write` en ESTA máquina
  Windows no puede arrancar NINGÚN proceso hijo (0xC0000142 en pwd/Get-Content); los 3 codex
  terminaron sin tocar nada (disciplina keystone correcta); su único modo funcional sería
  `--dangerously-bypass-approvals-and-sandbox`. (3) Owner decidió **fallback a claude los 3**.
  Asignación final: A→claude · B→claude · C→claude · D→claude · E→claude. Review adversarial
  cruzada entre subagentes (autor ≠ reviewer); A/B/C/D tocan rutas protegidas
  (billing/auth/secretos/migraciones) → cola de revisión humana con el reporte del reviewer.
- **Plan de integración:** merges FF secuenciales **C → D → B → A → E** con re-test, servidores
  frescos y `db:deploy` previo. Fusion points declarados: wirings de persistencia/infra (C/D/B) ·
  lockfile (D `@azure/*`, E vitest) · pines offline de los harnesses (D añade `VAULT_MODE`) ·
  `PLAN_CATALOG`/billing (solo A). E se rebasa y mergea AL FINAL.
- **Stream D — inversión de seguridad (patrón S15):** vault ausente ≠ stub silencioso en prod —
  el stub requiere `VAULT_MODE=offline` explícito y se rehúsa bajo `NODE_ENV=production`.

### Resultado del programa v3 (2026-07-06 PM3) — TODO merged en `main`

- **Integración secuencial** (FF, gates completos por merge, orden final **C→D→A→B→E** — B↔A se
  invirtió al necesitar B una ronda de fix): C Redis SsoStateStore (`fed65ff`+pin follow-up) →
  D Key Vault (`36853cb`, incl. fix de inyectividad case-insensitive) → A S14 token billing
  (`4add23a`, incl. fixes de review: `save()` ya no persiste contadores de uso [cierra también la
  race de slice 4] + cargo saturado a 2e9) → B Voyage BYOK (`8f4ce01`, incl. **gate de coherencia
  S19-6, decisión del owner**: la key org solo embebe dentro del espacio voyage de plataforma) →
  E Vitest 3 (`e6f7615`, rebase con lockfile regenerado; 0 adaptaciones de tests).
- **Post-merge:** typecheck · lint · **918 Docker-free** (domain 106 · application 343 · ui 25 ·
  api 290 · web 154) · int 23 · **BDD 198/1680** · Playwright 18 · **pnpm audit 0** (era 1 crítica
  + 5). Pines offline ahora ×5: BRAIN/SSO/EMAIL/PAYMENTS/**VAULT**_MODE.
- **Reviews adversariales con mutación real:** C (2 mutaciones cazadas) · D (APPROVE + hallazgo
  latente real: namespace case-insensitive de KV vs encoding case-preserving → fix pre-merge) ·
  A (APPROVE + 2 follow-ups de dinero cerrados pre-merge) · B (REQUEST_CHANGES por incoherencia de
  espacios de embedding → gate de coherencia + re-check ronda 2 APPROVE) · E (APPROVE, claims
  reproducidas). El protocolo de 2 capas (review → fix → re-check) funcionó tal cual.
- **Lecciones de proceso (nuevas):** (1) tras mergear una rama con cambio de schema Prisma,
  `prisma generate` en el checkout principal ANTES del gate (el gate A falló typecheck con el
  cliente stale; `pnpm install` solo no regenera). (2) El entorno mató 2 veces gates largos en
  background a mitad de Playwright → correr los gates de stack en tramos foreground. (3) Los
  worktrees creados antes de un commit serial de docs divergen — rebase sobre main antes del FF.
- **Follow-ups registrados:** tsup DTS roto pre-existente (`URL` en `stub-identity-provider.ts`
  S15; ningún gate de CI corre builds de paquetes) · hint UI para key voyage conectada-pero-gated ·
  pin `BRAIN_MODE=offline` a nivel ci.yml (cinturón+tirantes) · slice de provenance por chunk +
  re-embed al conectar · job de rollover de periodo (resetea AMBOS contadores) · smoke Voyage
  @manual · Stripe portal/proration/refunds · voz STT/TTS · Bloque 3 (decisión owner).

## Staging deploy (2026-07-06 PM4) — DECIDED by owner (spec: `specs/infra/staging-deploy.md`)

El owner pidió desplegar el primer ambiente (staging) y decidió las 4 preguntas (AskUserQuestion,
todas con la recomendación):
- **SD-1 Plataforma = Azure Container Apps** (la vía bicep de fundación, decisión #11).
- **SD-2 Vault = prod-like**: `NODE_ENV=production` + Azure Key Vault real + Managed Identity;
  `VAULT_MODE=offline` jamás en staging (valida S20 de verdad).
- **SD-3 Web = el API sirve la SPA** (un contenedor, un origen; `__Host-` + CSRF intactos;
  flag `WEB_DIST_DIR`, ausente = cero cambio de comportamiento).
- **SD-4 Ejecución = owner hace `az login` en sesión, el agente ejecuta los comandos az bajo
  supervisión** — relaja para este objetivo el contrato de fundación "el agente nunca despliega"
  (azure-environments.md §0); el runbook §8 del spec queda como vía manual.
- Alcance mínimo: sin Redis (API max 1 réplica, in-memory correcto), Service Bus/Blob/runners
  apagados por parámetro, keys reales ausentes al inicio (todo degrada a stub; se activan con
  `az keyvault secret set` + restart). Costo ~US$20–25/mes, Postgres detenible.
- **Cuenta Anthropic (duda del owner):** su plan Claude Max NO respalda el API del producto
  (suscripción de consumo, sin créditos de API, ToS). Para `ClaudeBrain` → cuenta **Claude
  Console** con créditos prepagados; workspace `gilgamesh-staging` + key scoped + spend limit
  mensual. Escala multi-equipo ya resuelta en producto: metering `BrainUsage` + quotas S14 por
  plan sobre la key de plataforma, y BYOK S9 para tenants grandes (facturan a su propia cuenta).
  Embeddings = cuenta Voyage AI aparte (sin ella, hash léxico — gate de coherencia S19-6).

### Staging deploy — RESULTADOS de ejecución F0–F3 (2026-07-07)

- **3 streams paralelos en worktrees anunciados** (`feat-staging-deploy` A · `feat-staging-image` B ·
  `feat-staging-bicep` C), subagentes Claude, reviews adversariales CON mutación real por stream y
  merges FF secuenciales A→B→C con gate completo por merge.
- **Review A (2 rondas):** F1 resuelto MANTENIENDO el contrato prod (`/api/v1/health` es el health
  real; `/health` pelón queda excluido del fallback = 404 JSON ruidoso, nunca fake-green HTML);
  3 mutaciones sobrevivientes muertas con pins nuevos (mutación A2 re-aplicada y verificada cazada);
  BONUS: `REDIS_URL` opcional en `loadConfig` (boot-blocker hallado independientemente por B y C;
  stores en memoria + WARN de boot en prod; whitespace-trim en ambos factories = NEW-1). APPROVE r2.
- **Review B:** F1 ORO — sin `name:` propio el compose staging habría RECREADO/DESTRUIDO el postgres
  de dev (mismo project por directorio); F3 `pg_isready -h 127.0.0.1` (el initdb temporal es
  socket-only) + healthcheck del app + `--wait`; F2 `.dockerignore` (+`.pnpm-store`, `.claude`,
  `*.bicepparam` — gitignore NO protege el build context). El stream ya había cazado él mismo el
  flavor del engine Prisma (openssl en AMBOS stages). Fixes mecánicos del propio "minimal required
  fixes" del reviewer, aplicados y validados en el gate M2.
- **Review C (2 rondas):** D1 bloqueante `uriComponent(pgPassword)` en el DSN (un password CSPRNG con
  chars URL-reservados brickeaba la fase 3 en crash-loop sin revisión previa a la cual caer); D2
  `timeoutSeconds: 5` en probes (default ACA = 1s vs boot swc-node); D5 `dependsOn acrPull`; D3/D6
  guards de params; D4/D7 a runbook/spec (multi-tag, start-Postgres-first, health real
  `/api/v1/health`). APPROVE r2.
- **Validación local M2 (gate antes de Azure):** imagen construida DESDE main (1.22 GB), stack
  `gilgamesh-staging` Healthy con `--wait` (migraciones dentro del contenedor), smoke Playwright
  staging 1/1 (SPA en `/`, registro→onboarding→agent room, round-trip autenticado same-origin,
  404 JSON bajo `/api/v1`, deep-link fallback). CSP de helmet NO rompe la SPA. Bicep compila limpio
  desde main vía contenedor azure-cli (az/bicep no instalados en la máquina).
- **Post-merge final:** typecheck · lint · **930 Docker-free** (+12) · int 23 · BDD 198/1680 ·
  Playwright 18 (default; el smoke staging queda excluido de la suite default).
- **F4 pendiente del owner:** instalar Azure CLI + `az login` + cuenta Claude Console (workspace
  `gilgamesh-staging` + spend limit). El agente ejecuta el runbook §8 bajo supervisión (SD-4).
  Azure CLI 2.88.0 YA instalado (winget, con OK del owner); falta solo el `az login`.

### Programa paralelo v4 (2026-07-07) — 5 follow-ups sin keystone, mientras F4 espera al owner

Con F4 (deploy) parado esperando el `az login`, se construyeron 5 follow-ups del backlog SIN cambio de
keystone (por eso corrieron en paralelo sin serializar), cada uno por subagente Claude con review
adversarial + mutación real, merges FF secuenciales con gate:
- **fix-tsup-dts** — el break de DTS pre-existente NO era falta de DOM lib (Buffer es solo-Node): era
  `@types/node` colándose transitivamente por vitest, invisible al worker `--dts` aislado de tsup. Fix
  = devDep explícito `@types/node`.
- **feat-ci-brain-pin** — `env:` a nivel de workflow en ci.yml pinea los 5 `*_MODE=offline`; verificado
  que ningún job corre NODE_ENV=production (los pines invertidos VAULT/SSO siempre se aceptan).
- **feat-voyage-ui-hint (slice 22)** — `platformVoyageActive?` aditivo en IntegrationView (solo fila
  voyage) derivado del gate S19-6 (`embeddings === 'voyage'`); hint ámbar "conectada-inactiva". APPROVE,
  cero mutaciones sobrevivientes (la inversión de false-reassurance cazada por varios tests).
- **feat-billing-rollover (slice 21)** — cierra S14-6: reset atómico de AMBOS contadores en un UPDATE
  (nunca `save()`); script `--all`/`--org`. **REQUEST_CHANGES → fixes:** F1 test de scope era una
  auto-comparación (in-memory devuelve el objeto que muta; una mutación `seats=999` había SOBREVIVIDO)
  → clon antes del reset; F2 el script REHÚSA sin `--all`/`--org` (footgun: zeroear todos los tenants);
  F3 smoke int que ejecuta el .mjs real (guarda de drift del SQL duplicado); F4 scrub del DSN. Re-check
  verde. Nota: divergencia contador-vs-ledger (la vista de uso all-time no se toca) documentada.
- **feat-web-error-boundary (slice 23)** — ErrorBoundary React (interno keyed por pathname = auto-
  recuperación + preserva SSE del chat en cambios de query; top-level alwaysDark). APPROVE + test de
  wiring `key={pathname}` que mató 2 mutaciones sobrevivientes.
- **Post-merge en `main`:** 963 Docker-free (dom 106 · app 357 · ui 25 · web 171 · api 304) · int 32 ·
  BDD 203/1734 · Playwright 18. Slices renumerados (billing 21 · voyage 22 · error-boundary 23; los
  tres habían elegido 21).

### Programa paralelo v5 (2026-07-07) — 5 hardening sin keystone (mientras F4 espera)

5 follow-ups de endurecimiento para el deploy, sin keystone, en paralelo, cada uno review adversarial
con mutación real, merges FF con gate integrado final:
- **request-id (slice 24):** X-Request-Id + `requestId` aditivo en el body RFC9457 + log con stack en
  500; id de cliente saneado (≤128, charset opaco) o UUID. APPROVE; el crux de inyección CRLF probado
  EMPÍRICAMENTE (JS `$` sin `m` = `\z`, rechaza `\n` final) + test unitario directo de normalizeRequestId.
- **web-http-resilience (slice 25):** timeout AbortController + retry con backoff SOLO en GET idempotente
  ({502,503,504}/network) + HttpError tipado; las MUTACIONES NUNCA reintentan (doble-cargo — probado por
  mutación). APPROVE; fix F1 ruteó los clientes crudos (getAgentRoom ya no cuelga) + F2/F3 pinearon la
  clasificación y el clearTimeout (2 mutaciones muertas).
- **bundle-size-gate (slice 26):** checker gzip sin dependencias (baseline 109 kB / budget 126 kB) + job
  de CI dedicado. Cierra el follow-up de slice 1.
- **health-readiness (slice 27):** `/api/v1/health/ready` (SELECT 1 con timeout 2s → 200/503 via @Res)
  DISTINTO de liveness (constante, SIN DB — ACA retiene tráfico en vez de crash-loop); port ReadinessProbe
  por wiring; probe bicep. APPROVE; ambas invariantes críticas (liveness-sin-DB, false-ready imposible)
  probadas por mutación.
- **ui-async-states (slice 28):** Spinner/ErrorState/EmptyState en @gilgamesh/ui (accesibles, tokens,
  CSS en ui NO en index.css) adoptados en ReportsScreen. APPROVE + guard de efecto restaurado.
- **Post-merge en `main`:** 1027 Docker-free (dom 106 · app 357 · ui 39 · web 189 · api 336) · int 34 ·
  BDD 203/1734 · Playwright 18 (un flake transitorio del smoke, verde aislado + re-run completo) ·
  bicep recompila limpio. Lección: el smoke wake-all flakea bajo carga del run completo pero pasa
  aislado — no confundir flake con regresión (verificar aislado antes de tocar código).
