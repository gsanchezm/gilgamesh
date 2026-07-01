# Gilgamesh — Architecture (Foundation Index)

> **Status:** Foundation **built** — slices 1–6 (Auth/Onboarding/Agent room · Test Lab authoring · Test
> Execution · Subscription & Billing · Knowledge/RAG · Integrations) are implemented, tested and shipped on
> `main`. This document describes the *design*; for a runnable quick start see [`README.md`](README.md), and
> for how to build a slice see [`CONTRIBUTING.md`](CONTRIBUTING.md). The 4 external/AI ports (Brain,
> TestKernel, PaymentProvider, RepoProvider) currently run deterministic offline **stubs** — the real
> adapters drop in behind the same interfaces later.
> **Authority:** This document is an INDEX. The single source of truth for names, enums, the agent
> roster, port signatures and the OpenAPI/schema skeleton is the **FROZEN keystone**
> ([`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md)). Where this
> document and the keystone disagree, the keystone wins. Owner decisions live in
> [`docs/research/decisions-log.md`](docs/research/decisions-log.md) and have authority over the
> prototype extract ([`docs/research/gilgamesh-prototype-extract.md`](docs/research/gilgamesh-prototype-extract.md)).
> **Read next:** monorepo conventions → [`docs/conventions/monorepo.md`](docs/conventions/monorepo.md).
> v0.2 — 2026-06-30 (foundation built; slices 1–6 shipped). The design below is unchanged; only the status
> header above was updated.

---

## 1. Product summary

**Gilgamesh** is a **multi-tenant web + mobile QA platform** where **11 deity-agents** — each a
mythological deity bound to a QA discipline — **plan, author and run software tests** across web, API,
mobile, performance, visual, security and accessibility, **collaborate on a visual DAG orchestration
canvas**, and **keep all results inside the app**. Dark mode by default (light toggle available),
**English-only (no i18n)**. Tagline: *"Testing · Trusted · Elevated."*

- **Tenancy:** `Org` is the root tenant; strict **row-level isolation by `orgId` on every query**. A
  `Project` lives under an `Org`. The 11 agents are a **per-Org catalog**; each agent's tool selection
  and awake/asleep state is a **per-Project `ToolBinding`**. No intermediate "Workspace" (YAGNI).
- **Agents:** the frozen roster (keystone §3) — Zeus (lead), Athena (arch), Anubis (manual),
  Quetzalcóatl (web), Iris (api), Freya (android), Isis (ios), Thor (perf), Xochiquetzal (visual),
  Odin (sec), Ra (a11y) — grouped into four families: `proceso`, `ui`, `backend`, `guardian`.
- **Execution:** **REAL execution from day 1** (no mock runner). Test runs are planned into a DAG and
  executed by the owner's **TOM kernel** (`chaos-proxy`, gRPC) behind the `TestKernel` port. Each agent
  registers as an `AgentPlugin` (Playwright / Appium / k6 / Pixelmatch / …).
- **Brains:** agents are driven by an LLM behind the `AgentBrainPort` (provider-agnostic; **default
  Claude (Anthropic)**), grounded by a **private, tenant-scoped RAG** (ISTQB + user PDFs via pgvector).
- **Slice 1 (first vertical):** **Auth (local) + Onboarding (3 steps → Org + Project + optional repo) +
  Agent room** (11 agents from DB, awake/busy/idle persisted, wake/sleep, KPIs). Runs **no tests** → not
  blocked by the external kernel. Chat/voice land in a later slice.

---

## 2. Locked stack

Everything below is **decided** (keystone §0 / decisions-log). TypeScript everywhere; packages are
`@gilgamesh/<name>`.

| Concern | Choice | Source |
|---|---|---|
| Language | **TypeScript** (strict) across apps + packages | keystone §0 |
| Monorepo build | **pnpm workspaces + Turborepo** (task graph + remote/local cache) | decisions #8 |
| API service | **NestJS** (`apps/api`) — interface adapters + infra, wires ports→adapters | decisions #7 |
| Async runners | **BullMQ** on Redis (`apps/workers`) — run-queue consumers | keystone §4 |
| Web | **React + Vite** (`apps/web`) | keystone §4 |
| Mobile | **Expo / React Native** (`apps/mobile`) | keystone §4 |
| Design system | **React + Tailwind** (`@gilgamesh/ui`) | keystone §4 |
| Persistence | **PostgreSQL** + **pgvector** (1536-dim embeddings), **Prisma** ORM | keystone §2,§4 |
| Cache / queue | **Redis** (BullMQ + cache) | decisions #11 |
| Object storage | **MinIO** (local) → **Azure Blob** (cloud); signed expiring URLs only | keystone §2,§5 |
| Event transport | `EventBus` port → Redis (local) / **Azure Service Bus** (cloud) | keystone §5 |
| Secrets | **Azure Key Vault** refs only — never raw tokens in DB/code | keystone §2 |
| Test kernel | gRPC adapter → owner's **chaos-proxy** (`:50051`) behind `TestKernel` | keystone §7 |
| Agent brain | `AgentBrainPort`, **default Claude (Anthropic)**; tiers `HAIKU \| SONNET \| OPUS` | decisions #6 |
| Auth | Local email/pass (**Argon2id**) + httpOnly session cookie → OIDC/SAML later | decisions #10 |
| Identity/Payment | `IdentityProvider` (Local now) / `PaymentProvider` (**Mock** now, Stripe later) | keystone §5 |
| Testing | **Vitest** (unit) · **Cucumber-js** (BDD/acceptance) · **Playwright** (e2e UI) | decisions #12 |
| CI | **GitHub Actions** (SDD/BDD/TDD + SAST/deps/secrets/DAST gates); Azure Pipelines parity later | decisions #12 |
| IaC / cloud | **Bicep** → Azure Container Apps (KEDA scale-to-zero), Postgres Flexible, Blob, Service Bus, Key Vault | decisions #11 |

> The LLM **model IDs and prices are deliberately not pinned here** — the decisions log defers them to
> Paso 2 with up-to-date data. This index references only the frozen `BrainTier` enum and `AgentBrainPort`.

---

## 3. Monorepo layout (keystone §4 — verbatim package set)

The platform is a **single monorepo** (hybrid strategy: platform monorepo + capability **polyrepo** for
the kernel/future capability engines, consumed as versioned deps behind ports — decisions #8). The
package/app set is **frozen** — do not add packages without a keystone change.

```
gilgamesh/
├─ apps/
│  ├─ web        (@gilgamesh/web)      React + Vite      — consumes api-client + ui
│  ├─ mobile     (@gilgamesh/mobile)   Expo / RN         — consumes api-client + shared logic
│  ├─ api        (@gilgamesh/api)      NestJS            — controllers (interface adapters) + infra
│  │                                                       (Prisma repos, BullMQ, storage); wires ports→adapters
│  └─ workers    (@gilgamesh/workers)  BullMQ            — run-queue consumers invoking @gilgamesh/kernel
├─ packages/
│  ├─ domain        (@gilgamesh/domain)        Entities, value objects, domain services. ZERO framework imports.
│  ├─ application   (@gilgamesh/application)   Use cases (one per slice action) + PORT interfaces. Depends on domain only.
│  ├─ kernel        (@gilgamesh/kernel)        TestKernel port + chaos-proxy gRPC adapter + AgentPlugin registry. (capability seam)
│  ├─ integrations  (@gilgamesh/integrations)  Adapters: PaymentProvider(Mock), IdentityProvider(Local), repo/tracking/comms/ci.
│  ├─ ui            (@gilgamesh/ui)            React + Tailwind design-system (tokens, agent tiles, DAG node, …).
│  ├─ api-client    (@gilgamesh/api-client)   Typed client generated from OpenAPI.
│  └─ config        (@gilgamesh/config)        Shared tsconfig / eslint (import-boundaries) / tailwind preset.
├─ specs/        Foundation specifications (this index + the map in §9).
└─ docs/         Conventions, research (decisions log, prototype extract), ADRs.
```

**Capability seam (decisions #5/#8):** the TOM kernel and any future capability engines the owner adds
live in **separate repos** and are absorbed behind stable ports in `@gilgamesh/kernel` /
`@gilgamesh/integrations` (open for extension, closed for modification). The monorepo wall is **not** the
boundary mechanism — module boundaries + import-boundary lint are (see §5 and `monorepo.md`).

---

## 4. Clean Architecture layering (dependencies point inward only)

The **dependency rule** is absolute: source code dependencies point **inward**. `@gilgamesh/domain` is
the innermost ring and imports **no framework** (no NestJS, Prisma, React, gRPC, Express — only the TS
stdlib). Ports are declared inward (`application`, plus the `kernel` capability seam); **adapters** that
touch frameworks/IO live outward (`apps/api`, `apps/workers`, `integrations`, the kernel's gRPC adapter).

```
        ┌─────────────────────────────────────────────────────────────┐
        │  COMPOSITION ROOTS (frameworks, IO, wiring)                   │
        │  apps/api (NestJS)  apps/workers (BullMQ)                     │
        │  apps/web (Vite)    apps/mobile (Expo)                        │
        └───────────────┬───────────────────────────┬─────────────────┘
                        │ wires ports→adapters       │ consumes
        ┌───────────────▼───────────────┐   ┌────────▼──────────────────┐
        │ ADAPTERS (outer)              │   │ PRESENTATION / TRANSPORT  │
        │ integrations  kernel(adapter) │   │ ui     api-client          │
        └───────────────┬───────────────┘   └───────────────────────────┘
                        │ implements
        ┌───────────────▼───────────────────────────────┐
        │ APPLICATION  — use cases + PORT interfaces      │   kernel(port surface):
        │  (AgentBrainPort, PaymentProvider, Identity-    │   TestKernel / AgentPlugin /
        │   Provider, ArtifactStorage, EventBus,          │   AgentPluginRegistry
        │   Repository<T> per aggregate)                  │   (pure interfaces, no framework)
        └───────────────┬─────────────────────────────────┘
                        │ depends on
        ┌───────────────▼───────────────┐
        │ DOMAIN (innermost)            │  entities · value objects · domain services
        │ ZERO framework imports         │  Org, User, Project, Run, RunNode, Agent, …
        └───────────────────────────────┘
```

**Allowed dependency edges (enforced — see `monorepo.md` §5):**

| Package / app | May import |
|---|---|
| `domain` | *(nothing but the TS stdlib)* |
| `application` | `domain` |
| `kernel` | `domain` *(port surface is pure, uses domain enums; gRPC adapter is wired only by apps)* |
| `integrations` | `domain`, `application` *(implements application ports)* |
| `api-client` | *(generated DTO types; no domain import)* |
| `ui` | `config` *(+ React/Tailwind); presentation only, props-driven* |
| `config` | *(nothing runtime — tsconfig/eslint/tailwind presets)* |
| `apps/api` | `domain`, `application`, `kernel`, `integrations` *(composition root)* |
| `apps/workers` | `domain`, `application`, `kernel` |
| `apps/web` | `api-client`, `ui` |
| `apps/mobile` | `api-client`, `ui` |

**Forbidden (must FAIL CI):** `domain` importing any framework or any outer package; `application`
importing NestJS/Prisma/React/gRPC; `ui` importing `application`/`domain`; one app importing another app;
any slice reaching into another slice's internals (§5). The frozen ports (keystone §5) are how outer rings
talk to inner ones — `AgentBrainPort`, `PaymentProvider`, `IdentityProvider`, `ArtifactStorage`,
`EventBus`, `Repository<T>` (one per aggregate: User, Org, Membership, Session, Project, Slice, Feature,
Scenario, TestCase, Agent, ToolBinding, Run, RunNode, Artifact, Integration, Subscription, KnowledgeDoc,
AuditLog), plus the kernel's `TestKernel` / `AgentPlugin` / `AgentPluginRegistry`.

---

## 5. Vertical-slice organization

Within `application` (and mirrored in `apps/api` controllers, `apps/web` views and tests), code is
organized by **vertical slice** (a user-facing capability), **not** by technical layer. Each slice owns
its use cases, DTOs, controller, UI view and acceptance tests end to end, and exposes a **narrow public
surface** (an index barrel) — siblings consume that surface, never each other's internals (Law of Demeter;
keystone §4). This is what the import-boundary lint guards (a rule failing CI when `slices/runs/...` imports
`slices/test-lab/internal/...`).

**Foundation slices** (each becomes a spec under `specs/slices/…`; Slice 1 is the first cut):

| # | Slice | Primary entities (keystone §2) | Runs tests? |
|---|---|---|---|
| 1 | **Auth + Onboarding + Agent room** | User, Session, Org, Membership, Project, Agent, ToolBinding | No → not blocked |
| 2 | **Test Lab** (BDD features + traditional cases) | Slice, Feature, Scenario, TestCase | No |
| 3 | **Orchestration** (DAG canvas, run + live events) | Run, RunNode, Artifact | **Yes → BLOCKED-UNTIL-DELIVERED** (§8) |
| 4 | **Reports** (from real runs) | Run, RunNode, Artifact | **Yes → BLOCKED-UNTIL-DELIVERED** (§8) |
| 5 | **Integrations** (6 groups, 17 keys) | Integration | No |
| 6 | **Subscription** (mock billing) | Subscription | No |
| 7 | **Knowledge** (private RAG upload + index) | KnowledgeDoc, KnowledgeChunk | No |

Cross-cutting concerns (audit, tenant resolution, rate-limit, error shape) are *not* slices — they are
middleware/decorators applied uniformly (see §7 and the security spec).

---

## 6. Design-pattern map

Each pattern is bound to a **specific keystone artifact** — this is how the patterns prove adherence
rather than float abstractly.

| Pattern | Where | Bound keystone artifact | Why |
|---|---|---|---|
| **Strategy** | Agent tool selection | `ToolBinding.tool ∈ per-role options` (keystone §3) | Each agent swaps its execution tool (web → Playwright \| Cypress; api → Postman \| REST Assured \| Karate) without changing the agent or callers. |
| **Factory / Registry** | Agent-plugin resolution | `AgentPluginRegistry.register/resolve(slot, tool)` → `AgentPlugin` (keystone §5) | Plugins self-register; the kernel resolves `(slot, tool)` → plugin at plan time. New capability repos register new plugins — open for extension, closed for modification (decisions #5). |
| **Adapter** | External systems | `PaymentProvider` (Mock→Stripe), `IdentityProvider` (Local→OIDC/SAML), repo/tracking/comms/ci adapters keyed by `Integration.key` (keystone §5,§8); chaos-proxy gRPC adapter (§7) | Swap a provider with no domain/UI change. Mock payment + local identity ship now; real ones land later behind the same port. |
| **Observer / Event-bus** | Run progress | `EventBus.publish/subscribe` carrying `RunEvent` (`NODE_STATE`/`LOG`/`ARTIFACT`/`SUMMARY`); surfaced to clients via `GET /runs/{id}/events` (SSE) (keystone §5,§6) | The kernel emits run events; workers/api fan them out; web subscribes for the live DAG + log without polling. |
| **Command** | Orchestration steps | `RunNode` (kind `DISPATCH`/`STAGE`/`CONSOLIDATE`) built from `StageSpec`; `TestKernel.plan→run→cancel` (keystone §2,§5) | Each DAG node is a reified, schedulable, cancelable unit of work with `deps` and `level`/`waves` — enqueue, execute, cancel uniformly. |
| **Repository** | Persistence | `Repository<T>` per aggregate (keystone §5) | Domain/application speak to aggregate repositories; Prisma implementations live in `apps/api` infra. Every repository query is **tenant-scoped by `orgId`** (keystone §2). |

Supporting: **Ports & Adapters (hexagonal)** is the overall shape (§4); **Dependency Injection** is how
`apps/api` (NestJS) wires port→adapter at the composition root.

---

## 7. Cross-cutting mandates — budgets & guardrails

Performance is **first-class** and security is **primordial** (decisions, cross-cutting mandates). These
are summarized here and specified in full in the performance and security specs (§9).

### 7.1 Performance budgets (enforced in CI)

| Budget | Target |
|---|---|
| API read latency (p95, excl. run execution) | **< 200 ms** |
| API write latency (p95) | **< 400 ms**; p99 **< 800 ms** |
| Run event stream | first `RunEvent` **< 1 s** after enqueue; fan-out delivery **< 250 ms** |
| Web route bundle | route-level lazy/code-split; initial per-route JS **< 200 KB** gzip; **LCP ≤ 2.5 s** (canonical Agent-room route budget — the value gated by Lighthouse CI in `ci-and-quality-gates.md` §5.3, referenced identically by `slice 01 §10.1`), TTI < 3.5 s (mid-tier) |
| DB access | every tenant query indexed on `orgId`; **no N+1**; bounded queries per request |
| Worker concurrency | bounded **waves** per plan tier (Team 3 / Pro 10 / Enterprise ∞ lanes — keystone §5,§9) |
| LLM cost | tiered routing (Haiku/Sonnet/Opus), **prompt caching** of shared preamble, tight RAG retrieval, batch API for bulk authoring, per-org token/run-minute quotas (decisions #6) |
| CI build | Turborepo cache-hit on unchanged packages; affected-only task runs (`monorepo.md` §4) |

### 7.2 Security guardrails (target OWASP ASVS L2)

- **Tenant isolation:** every list/detail/mutation filters by `orgId` resolved from the session; row-level
  isolation enforced in **every** repository query (keystone §2). No cross-org read path exists.
- **RBAC:** `Membership.role ∈ OWNER | ADMIN | MEMBER | VIEWER` gates every mutation.
- **Secrets:** only **Key Vault refs** persisted (`Integration.secretRef`, etc.) — never raw tokens.
- **Artifacts:** blobs are private; access only via **signed, expiring URLs** (`ArtifactStorage.signedUrl`,
  `GET /artifacts/{id}`).
- **Audit:** sensitive actions write `AuditLog` rows (actor, action, target, ip).
- **Transport/errors:** `/api/v1`, httpOnly session cookie, `Problem+json` (RFC 9457) errors, cursor
  pagination, rate-limit headers (keystone §6).
- **Pipeline gates:** SAST + dependency + secret scanning + DAST in CI (decisions #12).

---

## 8. External-capability seam (BLOCKED-UNTIL-DELIVERED)

Real runs need capabilities the owner is still building (keystone §7, decisions #4/#5). Everything is
designed behind the `TestKernel` port so the platform proceeds now; only the run-executing slices wait on
delivery.

- **Proceeds NOW** (no external dependency): Auth, Onboarding, Agent room, Test Lab authoring,
  Integrations, Subscription, Knowledge upload.
- **BLOCKED-UNTIL-DELIVERED:** Orchestration + Reports-from-real-runs. The owner must provide: a runnable
  **chaos-proxy** image (`:50051`) + at least the **Playwright** plugin + the **OmniPizza** sample SUT +
  the **proto/intents catalog** (`INTENT.*`, `ExecuteIntent`→`IntentResult`). These are tracked in the
  kernel spec (§9) as explicit blockers.

---

## 9. Foundation spec map (the index)

The keystone decomposes into the specs below. Paths are the **canonical locations** this index reserves;
sibling artifacts are authored in parallel, so some are `planned` at the time of writing. Status:
**FROZEN** (source of truth) · **this-doc** (authored here) · **planned** (reserved slot, authored by a
sibling agent).

| Area | Keystone anchor | Path | Status |
|---|---|---|---|
| **Keystone** (names/enums/roster/ports/skeleton) | all | [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md) | FROZEN |
| **Architecture index** (this file) | §4 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | this-doc |
| **Monorepo conventions** (pnpm/Turbo/boundaries) | §4 | [`docs/conventions/monorepo.md`](docs/conventions/monorepo.md) | this-doc |
| **API contract** (OpenAPI v1 full bodies) | §6 | [`specs/api/api-contract.md`](specs/api/api-contract.md) · [`specs/api/openapi.v1.yaml`](specs/api/openapi.v1.yaml) | planned |
| **Data model** (Prisma schema + dictionary) | §2 | [`specs/data/data-model.md`](specs/data/data-model.md) · [`specs/data/schema.prisma`](specs/data/schema.prisma) | planned |
| **Domain layer** (entities, VOs, services) | §2 | [`specs/domain/domain-model.md`](specs/domain/domain-model.md) | planned |
| **Application layer** (use cases + ports) | §5 | [`specs/application/use-cases-and-ports.md`](specs/application/use-cases-and-ports.md) | planned |
| **Kernel** (TestKernel port + chaos-proxy adapter + blockers) | §5,§7 | [`specs/kernel/test-kernel.md`](specs/kernel/test-kernel.md) | planned |
| **Integrations** (adapters; 17 keys) | §5,§8 | [`specs/integrations/integrations.md`](specs/integrations/integrations.md) | planned |
| **UI / design system** (tokens, components) | proto §11 | [`specs/ui/design-system.md`](specs/ui/design-system.md) | planned |
| **Security** (tenant isolation, RBAC, audit, ASVS L2) | §2,§6 | [`specs/security/security-spec.md`](specs/security/security-spec.md) | planned |
| **Performance** (budgets, caching, concurrency) | mandates | [`specs/performance/performance-budgets.md`](specs/performance/performance-budgets.md) | planned |
| **Infra / IaC** (Bicep, Azure QA env) | decisions #11 | [`specs/infra/azure-foundation.md`](specs/infra/azure-foundation.md) | planned |
| **Testing & CI** (Vitest/Cucumber/Playwright + gates) | decisions #12 | [`specs/testing/test-and-ci-strategy.md`](specs/testing/test-and-ci-strategy.md) | planned |
| **Slice 1** (Auth + Onboarding + Agent room) | §3, decisions #3 | [`specs/slices/slice-1-auth-onboarding-agent-room.md`](specs/slices/slice-1-auth-onboarding-agent-room.md) | planned |

> Sibling specs MUST adhere to the keystone verbatim. If a sibling needs a name not in the keystone, it is
> added to the keystone first, never invented locally — and this map updates to point at it.

---

## 10. Where to look next

- **Live product status (as-built):** [`docs/research/feature-status.md`](docs/research/feature-status.md) —
  the board of what's shipped vs. in-progress vs. blocked. Note the build order diverged from the §5 plan:
  as-built, slices 3–6 are Execution / Subscription / Knowledge / Integrations and **slice 7 = the *Look & feel*
  re-skin** (in progress). Per-slice detail lives in [`CLAUDE.md`](CLAUDE.md).
- **Build & boundaries:** [`docs/conventions/monorepo.md`](docs/conventions/monorepo.md) — pnpm
  workspaces, Turborepo task graph/caching, `@gilgamesh/*` naming, and the **import-boundary enforcement**
  that fails CI on inward-rule or cross-slice violations.
- **Vocabulary (frozen):** [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md).
- **Why things are the way they are:** [`docs/research/decisions-log.md`](docs/research/decisions-log.md).
