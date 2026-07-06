# Gilgamesh — Foundation Keystone (FROZEN shared vocabulary)

> This file is the single source of truth for names, enums, the canonical agent roster, port
> signatures, and the OpenAPI/schema skeleton. Every foundation artifact MUST adhere to it
> **verbatim** — same entity names, field names, enum values, IDs, and port signatures.
> If an artifact needs a name not defined here, it adds it here first (don't invent locally).
> Authored centrally (full design context). Expansions fan out from this. v0.3 — 2026-07-05.

## 0. Conventions
- TypeScript everywhere. Package names `@gilgamesh/<name>`.
- DB: snake_case tables/columns; Prisma models PascalCase; API JSON camelCase.
- IDs: UUID v7 (`id`), string. Every tenant-scoped row carries `orgId` (FK, indexed) — **enforced in every query** (row-level tenant isolation).
- Timestamps: `createdAt`, `updatedAt` (UTC). Soft-delete via `deletedAt?` only where noted.
- API base path: `/api/v1`. Auth via httpOnly session cookie (slice 1) → swappable to OIDC later.
- Enum values are SCREAMING_SNAKE in code/DB unless they are stable lowercase keys (agent slots, integration keys) — noted per enum.

## 1. Frozen enums
```
Role               = OWNER | ADMIN | MEMBER | VIEWER
ProjectFormat      = BDD | TRADITIONAL
AgentSlot (key)    = lead | arch | manual | web | api | android | ios | perf | visual | sec | a11y
AgentFamily (key)  = proceso | ui | backend | guardian
AgentRuntimeStatus = ACTIVE | BUSY | IDLE        # derived: IDLE if !enabled; BUSY if in a running RunNode; else ACTIVE
TestCasePriority   = HIGH | MEDIUM | LOW
TestCaseStatus     = NOTRUN | PASS | FAIL | BLOCKED | SKIPPED
RunStatus          = QUEUED | RUNNING | DONE | FAILED | CANCELED
RunMode            = BDD | STEPS
RunTrigger         = MANUAL | CI | SCHEDULE
RunNodeKind        = DISPATCH | STAGE | CONSOLIDATE
RunNodeState       = IDLE | QUEUED | RUNNING | DONE_PASS | DONE_FAIL
ArtifactType       = VIDEO | SCREENSHOT | HAR | LOG | REPORT_HTML
CaptureMode        = OFF | ON_FAIL | ALWAYS | ON_DEMAND
IntegrationGroup   = SOURCE_REPOS | PROJECT_TRACKING | TEST_MANAGEMENT | COMMUNICATION | CICD | DEVICES_BROWSERS | AI_PROVIDERS
Plan               = FREE | STARTER | GROWTH | SCALE
BillingCycle       = MONTHLY | ANNUAL
SubscriptionStatus = TRIALING | ACTIVE | PAST_DUE | CANCELED
KnowledgeDocStatus = UPLOADED | INDEXING | INDEXED | FAILED
BrainTier          = HAIKU | SONNET | OPUS
BrainSurface       = CHAT | ROUTER | GENERATE | EMBED   # where a brain call originated (metering dimension)
ChatMessageRole    = USER | AGENT | SYSTEM
KnowledgeScope (key) = <AgentSlot key> | shared   # lowercase keys; nullable on KnowledgeChunk
```

## 2. Entities (data-model dictionary — fields are authoritative; types abbreviated)
- **Org** — id, name, slug(unique), createdAt, updatedAt. Root tenant.
- **User** — id, email(unique, citext), passwordHash(Argon2id), firstName, middleName?, lastName, status(ACTIVE|DISABLED), createdAt, updatedAt. Global (can belong to many Orgs).
- **Membership** — id, orgId, userId, role:Role, createdAt. Unique(orgId,userId). RBAC join.
- **Session** — id, userId, tokenHash, expiresAt, ip?, userAgent?, createdAt, revokedAt?. Local-auth sessions.
- **Project** — id, orgId, name, slug, format:ProjectFormat, repoProvider?(github|gitlab|bitbucket|ado), repoFullName?, repoBranch?, repoCommit?, repoLastSyncAt?, createdAt, updatedAt. Unique(orgId,slug).
- **Slice** — id, orgId, projectId, key, name, order. Vertical slice (Checkout/Login/Catalog/Payments/Imported). Unique(projectId,key).
- **Feature** — id, orgId, projectId, sliceId?, name, path, content(gherkin text), updatedAt, createdAt. BDD `.feature`.
- **Scenario** — id, orgId, featureId, name, order, lastStatus:TestCaseStatus?. Parsed scenario in a Feature.
- **TestCase** — id, orgId, projectId, sliceId?, key(e.g. TC_CHK_001), title, steps(text), data(text), expected(text), priority:TestCasePriority, status:TestCaseStatus, assignedAgentId?, createdAt, updatedAt.
- **Agent** — id, orgId, slot:AgentSlot, deityName, role(label), family:AgentFamily, glyph, culture, defaultTool, createdAt. Per-Org catalog (the 11). Unique(orgId,slot). Seeded from roster (§3).
- **ToolBinding** — id, orgId, projectId, agentId, tool(string ∈ per-role options), enabled(bool=awake), updatedAt. Unique(projectId,agentId). Per-Project agent state + tool selection (Strategy).
- **Run** — id, orgId, projectId, status:RunStatus, mode:RunMode, trigger:RunTrigger, selectedStages(string[]), progress(int 0..100), runLabel, commitSha?, passed?, failed?, skipped?, total?, ratePct?, durationMs?, createdById, startedAt?, finishedAt?, createdAt.
- **RunNode** — id, orgId, runId, key, kind:RunNodeKind, agentId?, tool?, feature?, sliceId?, level(int), deps(string[]), state:RunNodeState, passed?, failed?, skipped?, durationMs?, startedAt?, finishedAt?. DAG node.
- **Artifact** — id, orgId, runId, runNodeId?, type:ArtifactType, storageKey, contentType, sizeBytes, capturedAt, meta(json). Blob via signed expiring URL (never public).
- **Integration** — id, orgId, key(stable, §8), group:IntegrationGroup, connected(bool), secretRef?(Key Vault ref — NEVER raw token), config(json non-secret), connectedById?, connectedAt?. Unique(orgId,key).
- **Subscription** — id, orgId(unique), plan:Plan, billingCycle:BillingCycle, seats(int), status:SubscriptionStatus, runMinutesQuota(int), runMinutesUsed(int), providerCustomerId?, providerSubscriptionId?, currentPeriodEnd?. Mock provider now.
- **KnowledgeDoc** — id, orgId, projectId?, name, sizeBytes, storageKey, status:KnowledgeDocStatus, createdById, createdAt. Private RAG source.
- **KnowledgeChunk** — id, orgId, docId, ordinal, content(text), embedding(vector(1536)),
  scope?:KnowledgeScope(indexed; `shared` or NULL = visible to all agents; an AgentSlot key = visible
  only to that agent's retrieval). pgvector; tenant-scoped retrieval.
- **ChatSession** — id, orgId, projectId, agentId?(pinned agent when opened from an agent tile; null =
  routed per message), createdById, createdAt, updatedAt.
- **ChatMessage** — id, orgId, sessionId, role:ChatMessageRole, agentId?(the answering/attributed agent),
  content(text), runId?(links a message that triggered a Run), createdAt.
- **BrainUsage** — id, orgId, tier:BrainTier, surface:BrainSurface, inputTokens(int), outputTokens(int),
  cacheReadTokens(int=0), cacheCreateTokens(int=0), createdAt. Per-call token metering (indexed
  orgId+createdAt); aggregated per org for the usage view. Billing hookup = the 4-tier billing migration.
- **AuditLog** — id, orgId, actorUserId?, action, targetType, targetId?, metadata(json), ip?, createdAt. Sensitive-action audit.

## 3. Canonical agent roster (DESKTOP prototype — decided) + per-role tool options (Strategy)
| slot | deityName | family | glyph | culture | tool options (first = default) |
|------|-----------|--------|-------|---------|--------------------------------|
| lead | Zeus | proceso | ZE | Grecia | Helix Core |
| arch | Athena | proceso | AT | Grecia | Strategy |
| manual | Anubis | proceso | AN | Egipto | Suites · Steps |
| web | Quetzalcóatl | ui | QC | Azteca | Playwright, Cypress |
| api | Iris | backend | IR | Grecia | Postman, REST Assured, Karate |
| android | Freya | ui | FR | Escandinavia | Appium, Mobilewright |
| ios | Isis | ui | IS | Egipto | Appium, Mobilewright |
| perf | Thor | backend | TH | Escandinavia | k6, Gatling, JMeter |
| visual | Xochiquetzal | ui | XO | Azteca | Pixelmatch, Applitools |
| sec | Odin | guardian | OD | Escandinavia | OWASP ZAP, Burp Suite |
| a11y | Ra | guardian | RA | Egipto | axe-core, Pa11y |
family colors: proceso #A07D2C · ui #3F6FA3 · backend #7E63A6 · guardian #2F8F78.

## 4. Layer & package map (Clean Architecture; deps point inward only)
```
@gilgamesh/domain        — entities, value objects, domain services. ZERO framework imports.
@gilgamesh/application    — use cases (one per slice action) + PORT interfaces (below). Depends on domain only.
@gilgamesh/kernel         — TestKernel port + chaos-proxy gRPC adapter + AgentPlugin registry. (capability seam)
@gilgamesh/integrations   — adapters: PaymentProvider(Mock), IdentityProvider(Local), repo/tracking/comms/ci adapters.
@gilgamesh/ui             — React + Tailwind design-system components (tokens, agent tiles, DAG node, etc.).
@gilgamesh/api-client     — typed client generated from OpenAPI.
@gilgamesh/config         — shared tsconfig/eslint(import-boundaries)/tailwind preset.
apps/api      (NestJS)    — interface adapters (controllers) + infra (Prisma repos, BullMQ, storage). Wires ports→adapters.
apps/workers  (BullMQ)    — run queue consumers invoking @gilgamesh/kernel.
apps/web      (React+Vite)— consumes api-client + ui.
apps/mobile   (Expo)      — consumes api-client + shared logic.
```
Import-boundary lint MUST fail CI if domain imports a framework, or a slice reaches into another slice's internals (Law of Demeter).

## 5. Port signatures (FROZEN — adapters implement these)
```ts
// @gilgamesh/kernel
type ExecuteIntent = { intentId: string; payload: unknown; locatorKey?: string; platform: string; viewport?: {w:number;h:number} };
type IntentResult  = { status: 'PASS'|'FAIL'|'ERROR'; payload?: unknown; metrics?: Record<string,number> };
interface AgentPlugin { slot: AgentSlot; tool: string; supportedIntents: string[]; execute(i: ExecuteIntent): Promise<IntentResult>; }
interface AgentPluginRegistry { register(p: AgentPlugin): void; resolve(slot: AgentSlot, tool: string): AgentPlugin | null; }

type RunPlanInput = { runId: string; projectId: string; mode: RunMode; stages: StageSpec[] };
type StageSpec    = { key: string; slot: AgentSlot; tool: string; feature?: string; deps: string[] };
type RunPlan      = { runId: string; nodes: PlanNode[]; waves: string[][] };          // nodes incl. __dispatch/__consolidate
type RunEvent =
  | { type:'NODE_STATE'; nodeKey:string; state:RunNodeState; at:string }
  | { type:'LOG'; nodeKey?:string; level:'sys'|'run'|'pass'|'fail'|'log'; text:string; at:string }
  | { type:'ARTIFACT'; nodeKey:string; artifact:{ type:ArtifactType; storageKey:string; contentType:string; sizeBytes:number } } // INTERNAL kernel→api event only; the external SSE wire DTO maps storageKey→artifactId — never expose storageKey to the browser
  | { type:'SUMMARY'; passed:number; failed:number; skipped:number; total:number; ratePct:number; durationMs:number };
interface TestKernel {
  plan(input: RunPlanInput): RunPlan;                       // dispatch → stages by deps → consolidate
  run(plan: RunPlan): { runId: string; events: AsyncIterable<RunEvent> }; // executes via chaos-proxy
  cancel(runId: string): Promise<void>;
}

// @gilgamesh/application ports
interface AgentBrainPort {                                  // LLM behind a port (provider-agnostic; default Claude)
  complete(req: { tier: BrainTier; system: string; messages: {role:string;content:string}[]; cacheKey?: string }): Promise<{ text: string; usage: {inputTokens:number; outputTokens:number} }>;
  stream(req: Parameters<AgentBrainPort['complete']>[0]): AsyncIterable<{ delta: string }>;
  embed(texts: string[]): Promise<number[][]>;
}
interface PaymentProvider {                                 // MOCK now; Stripe later — no UI/domain change
  createCheckout(i:{orgId:string;plan:Plan;cycle:BillingCycle;seats:number}): Promise<{checkoutUrl:string}>;
  getSubscription(orgId:string): Promise<Subscription>;
  listInvoices(orgId:string): Promise<Invoice[]>;
  updateSeats(orgId:string, seats:number): Promise<void>;
  handleWebhook(sig:string, body:Buffer): Promise<void>;
}
interface IdentityProvider {                                // Local(email/pass) now; SSO/SAML/Entra later
  kind: 'LOCAL'|'OIDC'|'SAML';
  startLogin?(redirect:string): Promise<{authUrl:string}>;
  completeLogin(input: unknown): Promise<{ userId: string }>;
}
interface ArtifactStorage { put(key:string, data:Buffer|NodeJS.ReadableStream, contentType:string): Promise<void>; signedUrl(key:string, ttlSec:number): Promise<string>; }
interface EventBus { publish(topic:string, e:unknown): Promise<void>; subscribe(topic:string, h:(e:unknown)=>void): () => void; }
// Repository<T> per aggregate: User, Org, Membership, Session, Project, Slice, Feature, Scenario,
//   TestCase, Agent, ToolBinding, Run, RunNode, Artifact, Integration, Subscription, KnowledgeDoc,
//   ChatSession, ChatMessage, BrainUsage, AuditLog.
```

## 6. OpenAPI v1 — resource & schema skeleton (full bodies expanded by the API-contract artifact)
Resources (paths): `/auth/{register,login,logout,me,forgot-password,reset-password}` ·
`/orgs`,`/orgs/{orgId}`,`/orgs/{orgId}/members`,`/orgs/{orgId}/members/{id}` (PATCH role change, DELETE remove) · `/projects`,`/projects/{id}` (POST = onboarding: creates Project [+repo]) ·
`/orgs/{orgId}/agents` (catalog) · `/projects/{id}/agents` (+toolbinding+runtime status), `PATCH /projects/{id}/agents/{slot}`, `POST /projects/{id}/agents/wake-all` ·
`/projects/{id}/slices`, `/projects/{id}/features`,`/features/{id}`, `/projects/{id}/test-cases`,`/test-cases/{id}`, `/projects/{id}/test-cases/import`, `/projects/{id}/test-cases/generate` ·
`/projects/{id}/runs` (POST enqueue), `/runs/{id}`, `/runs/{id}/events` (SSE stream of RunEvent), `/runs/{id}/cancel` ·
`/runs/{id}/report`, `/runs/{id}/nodes/{nodeId}`, `/artifacts/{id}` (returns signed URL) ·
`/orgs/{orgId}/integrations`, `PATCH /orgs/{orgId}/integrations/{key}` ·
`/projects/{id}/knowledge` (POST upload, GET list, DELETE) ·
`POST /projects/{id}/chat` (create ChatSession) · `POST /chat/{sessionId}/messages` (send message) ·
`GET /chat/{sessionId}/events` (SSE stream, same pattern as `/runs/{id}/events`) ·
`GET /orgs/{orgId}/brain/usage` (aggregated per-tier/per-surface token usage) ·
`/orgs/{orgId}/subscription`, `/orgs/{orgId}/subscription/checkout` · `/orgs/{orgId}/audit`.
Schema names = entity names in §2 + request/response DTOs `*Create`,`*Update`,`*View`,`MeView`(session context: user + memberships + activeOrgId),`ProjectAgentView`(Agent + per-project ToolBinding + derived AgentRuntimeStatus),`RunEvent`,`ReportView`,`Problem`(RFC9457 errors).
Cross-cutting: every request resolves tenant from session→`orgId`; every list/detail filters by `orgId`; `Problem+json` errors; cursor pagination; rate-limit headers.

## 7. External-dependency contract — "REAL execution from day 1" (decision #4/#5)
Real runs require capabilities the owner is still building (decision #5). To avoid a silent wall:
- `@gilgamesh/kernel` adapter speaks gRPC to the owner's **chaos-proxy** (:50051). REQUIRED from it:
  intents catalog (`INTENT.*`), `ExecuteIntent`→`IntentResult` contract, locator resolution, per-plugin ports
  (Playwright/Appium/k6/Pixelmatch). Plugins emit artifacts (video/screenshot/HAR) the kernel surfaces as `RunEvent.ARTIFACT`.
- A **sample System-Under-Test** (OmniPizza) must be runnable for the runners to hit.
- **Orchestration / Reports-from-real-runs slices = BLOCKED-UNTIL-DELIVERED**: list exactly what the
  owner must provide (a runnable chaos-proxy image + at least the Playwright plugin + OmniPizza target +
  the proto/intents). Everything else (Auth, Onboarding, Agent room, Test Lab authoring, Integrations,
  Subscription, Knowledge upload) proceeds NOW behind the `TestKernel` port without these.
- Slice 1 (Auth+Onboarding+Agent room) runs NO tests → not blocked.

## 8. Stable integration keys (Integration.key)
`github, gitlab, bitbucket, ado_repos` (SOURCE_REPOS) · `jira, ado_boards` (PROJECT_TRACKING) ·
`testrail, xray, zephyr` (TEST_MANAGEMENT) · `slack, teams` (COMMUNICATION) ·
`gha, gitlabci, azpipe, jenkins` (CICD) · `sim, browserstack` (DEVICES_BROWSERS) ·
`anthropic` (AI_PROVIDERS).

## 9. Pricing (mock) reference for Subscription seeds
FREE $0 (1 workspace · 2 services · 500 executions) · STARTER $29/mo (unlimited workspaces · 5 services ·
5,000 executions · 3 users) · GROWTH $99/mo (15 services · 25,000 executions · unlimited users) · SCALE
$499/mo base includes 10 workspaces + $99/extra workspace (unlimited executions/services, SSO/RBAC/SLA).
Annual billing charges 10 months (2 months free).

## 10. Changelog
- **v0.3 — 2026-07-05** — Brain amendment: +`AI_PROVIDERS` group + `anthropic` key (§1/§8) ·
  +`BrainSurface` (§1) · +`BrainUsage` (§2/§5) · +`GET /orgs/{orgId}/brain/usage` (§6).
  Nothing frozen was renamed, removed, or restructured.
- **v0.2 — 2026-07-05** — Agent Chat (text) amendment: +`ChatSession`/`ChatMessage` (§2) ·
  +`ChatMessageRole`/`KnowledgeScope` (§1) · `KnowledgeChunk.scope?` (§2) · +chat routes (§6) ·
  +Chat repositories (§5). Nothing frozen was renamed, removed, or restructured.
- **v0.1 — 2026-06-29** — initial frozen vocabulary. (2026-07-01: `Plan` enum + §9 moved to the 4-tier
  workspace pricing — amended without a version bump; predates this changelog.)
