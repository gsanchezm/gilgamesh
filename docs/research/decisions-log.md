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
