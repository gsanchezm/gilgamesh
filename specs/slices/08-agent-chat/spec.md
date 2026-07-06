# Slice 8 — Agent Chat (text) (SDD Spec)

> Spec-Driven-Design spec for the eighth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.2** — this slice
> depends on the v0.2 Agent Chat amendment: `ChatSession`/`ChatMessage`/`ChatMessageRole`/`KnowledgeScope`/
> `KnowledgeChunk.scope`/chat routes).
> v0.2 — 2026-07-05. Status: BUILT — SDD→BDD→TDD green end-to-end on branch `slice-8-agent-chat`
> (typecheck + lint · 501 Docker-free unit/e2e · `test:int` 19 · **BDD 112 scenarios / 896 steps**).
> Scope: text chat with the pantheon behind the **deterministic stub brain** (owner decision S8).

---

## 0. Owner decision S8

Owner picked **Agent Chat (text)** as slice 8 (2026-07-05); the keystone was amended to **v0.2** first, in
series on `main`, before this worktree (ORCHESTRATION_PLAN rule 2). **Decision S8: wire `AgentBrainPort` to
the existing deterministic stub (`DeterministicBrain`) extended with canned responses per `AgentSlot`** — the
Billing `MockPaymentProvider` pattern — so the slice is offline, reproducible, and **NOT blocked** by the real
Brain adapter or chaos-proxy delivery. Consequences:
- **Real answers** land with the Brain slice (the `AgentBrainPort` Claude adapter: tiering, caching, BYOK).
- **Real tool execution** (actual test runs) stays behind chaos-proxy + the Playwright plugin (keystone §7
  `BLOCKED-UNTIL-DELIVERED`); chat's `enqueue_run` works **now** through the standard slice-3 `TriggerRun`
  path against the `DeterministicKernel`.
- **Voice (STT/TTS), multi-agent deliberation, and per-agent voices are out of scope** for this slice.

---

## 1. Feature intent

Let a member **talk to the agent pantheon** in-app. The user talks to *Gilgamesh* (the platform's single chat
entry point); a **router** classifies each message to the right **`AgentSlot`** so the matching deity answers
— or the chat is opened from a specific agent's tile and that agent is **pinned**. Before answering, the agent
**retrieves** org knowledge **scoped to its specialty** (`KnowledgeChunk.scope`), and answers **streaming**
over SSE with its persona. The agent can act, not just talk: it may invoke **existing use cases only** as
tools — author a test case, generate a feature draft, or **enqueue a run** through the standard Run path
(quota, RBAC, audit all apply), with run progress **narrated back into the chat**.

---

## 2. Scope

### In scope
- **`ChatSession` create** — `POST /projects/{id}/chat`; optional `agentId` **pin** (opened from an agent
  tile). Pinned agent must exist in the org catalog.
- **Send message** — `POST /chat/{sessionId}/messages`: persists the `USER` `ChatMessage`, then routing →
  retrieval → answer; the `AGENT` answer persists and streams.
- **Routing** — a router use case classifies the message to an `AgentSlot` via `AgentBrainPort.complete()`
  at **`HAIKU`** tier. Confidence **< 0.6** → fall back to **lead** (Zeus). Agents whose per-project
  `ToolBinding.enabled = false` are **excluded** from routing; if the routed slot is excluded → fall back to
  lead. **Pinned sessions skip routing entirely** (no classify call).
- **Scoped retrieval** — before answering, retrieve `KnowledgeChunk`s filtered by **`orgId` AND
  (`scope` = the agent's slot OR `scope` = `shared` OR `scope IS NULL`)**, pgvector similarity, top-k.
- **Answering** — `AgentBrainPort.stream()` with the agent's **persona system prompt** + retrieved context;
  streamed to the client via `GET /chat/{sessionId}/events` (SSE, same pattern as `/runs/{id}/events`).
- **Tool-calling (whitelist of exactly 3, existing use cases only)** — `create_test_case` (slice-2
  `CreateTestCase`), `generate_feature` (slice-2 `GenerateDrafts`), `enqueue_run` (slice-3 `TriggerRun`:
  quota, RBAC, `AuditLog` all apply). When a run is enqueued, set **`ChatMessage.runId`** on the triggering
  message and **narrate `RunEvent`s back into the chat** via the existing SSE; the terminal run summary
  persists as a `SYSTEM` `ChatMessage` linked by `runId`.
- Cross-cutting: per-`orgId` tenant isolation, RBAC, CSRF on mutations, rate-limited send, audit, RFC9457
  errors, validation, **both persistence wirings** (in-memory + Prisma; `ChatSession`/`ChatMessage` models +
  migration incl. the indexed `KnowledgeChunk.scope` column).

### Out of scope (explicitly deferred)
- **Voice** — STT/TTS and per-agent voices (owner: later voice slice).
- **Multi-agent deliberation** — agents conversing with each other / group answers.
- **Real LLM** — `DeterministicBrain` canned-per-slot responses only; the Claude adapter is the Brain slice.
- **Real test execution** — chaos-proxy + plugins (§7 `BLOCKED-UNTIL-DELIVERED`); `enqueue_run` rides the
  slice-3 `DeterministicKernel`.
- **Session list / history read endpoints & UI** — keystone v0.2 defines only the 3 chat routes; a session
  rail / history browser needs a route amendment (open question §13).
- Message edit/delete, attachments, reactions, typing indicators; cross-project sessions.

---

## 3. Actors / personas

| Actor | Description | Slice-8 capabilities |
|-------|-------------|----------------------|
| **Owner / Admin** (`OWNER`/`ADMIN`) | Tenant leads. | Create sessions, chat, all 3 tools (per their RBAC). |
| **Member** (`MEMBER`) | Standard member. | Create sessions, chat, tools execute under the member's own RBAC (all 3 are `MEMBER`+ per slices 2–3). |
| **Viewer** (`VIEWER`) | Read-only member. | Cannot chat: create session / send message → `403` (chat mutates via tools; no read route this slice). |
| **Anonymous** | Not authenticated. | No access (`401`). |

---

## 4. User stories

- **US-1** As a member, I talk to Gilgamesh and my question reaches the **right deity** (a perf question →
  Thor), so I get specialist answers without picking an agent.
- **US-2** As a member, I open chat **from an agent's tile** and talk to that agent directly — no routing.
- **US-3** As a member, my vague question is answered by **Zeus (lead)** instead of being misrouted.
- **US-4** As a member, a **sleeping agent** (`ToolBinding.enabled = false`) never answers — the lead covers.
- **US-5** As a member, answers are **grounded** in my org's knowledge, scoped per agent specialty — the
  security playbook grounds Odin, not Thor.
- **US-6** As a member, I ask an agent to **create a test case**, **generate a feature draft**, or **run
  tests** from the chat, and it happens through the same rules as the buttons (RBAC/quota/audit).
- **US-7** As a member, I watch a chat-triggered run's **progress narrated** in the conversation.
- **US-8** As a tenant, none of my sessions/messages/chunks is ever visible to another tenant.

---

## 5. Data contracts touched

All fields/types are authoritative from keystone §2/§1 (v0.2).

| Entity | Slice-8 usage | Key fields exercised |
|--------|---------------|----------------------|
| **ChatSession** | **new** — create + resolve on send/stream. | `orgId`, `projectId`, `agentId?`(pin), `createdById`. |
| **ChatMessage** | **new** — persist USER/AGENT/SYSTEM messages. | `orgId`, `sessionId`, `role:ChatMessageRole`, `agentId?`, `content`, `runId?`. |
| **KnowledgeChunk** | read — scoped retrieval. | `orgId`, `scope?:KnowledgeScope`(indexed), `embedding`. |
| **Agent** | read — roster/persona + pin validation (∈ org catalog). | `orgId`, `slot`, `deityName`, Unique(`orgId`,`slot`). |
| **ToolBinding** | read — the routing exclusion gate. | `projectId`, `agentId`, `enabled`. |
| **Run** | write via the existing `TriggerRun` (unchanged). | `createdById`, `trigger:MANUAL`, quota charge. |
| **Subscription** | read/charge via `TriggerRun` (slice-4 quota, unchanged). | `runMinutesQuota`, `runMinutesUsed`. |
| **Project** | read — sessions are project-scoped; tenant resolved via it. | `orgId`. |
| **AuditLog** | written on §9 actions. | `action`, `targetType`, `targetId?`, `metadata`. |

**Derived (not stored):** the routing decision (`AgentSlot` + confidence) — consumed in-request; the answering
agent is recorded as `ChatMessage.agentId`. Retrieval context is not persisted.

**Seed / defaults (deterministic):** sender messages `role = USER`; answers `role = AGENT` +
`agentId` = the answering agent; run narration summary `role = SYSTEM` + `runId`. `DeterministicBrain` maps
each `AgentSlot` to a stable canned answer and a stable classification (keyword → slot + confidence) — same
input, same output, offline.

---

## 6. API operations used (keystone §6, v0.2)

Base path `/api/v1`. Auth via httpOnly session cookie + CSRF on unsafe methods. Errors are `Problem+json`.
Tenant resolved from session → active `Membership.orgId`; a session/project in another tenant returns `404`.

| # | Method + path | Purpose | Request DTO | Response DTO |
|---|---------------|---------|-------------|--------------|
| C1 | `POST /projects/{id}/chat` | Create a `ChatSession` (optional `agentId` pin). | `ChatSessionCreate` | `ChatSessionView` |
| C2 | `POST /chat/{sessionId}/messages` | Send a `USER` message → route → retrieve → answer (+tools). | `ChatMessageCreate` | `ChatMessageView` (the persisted USER message; the answer arrives on C3) |
| C3 | `GET /chat/{sessionId}/events` | SSE stream (keystone pattern). **As built:** with the synchronous stub núcleo it REPLAYS the session's persisted messages as `MESSAGE` events and closes with `DONE`; live delta push lands with the real Brain delivery (§13). | — | SSE of `ChatEvent`* |

\* `ChatEvent` (`{ type:'MESSAGE'|'DELTA'|'TOOL'|'RUN_NODE'|'RUN_SUMMARY'|'DONE', … }`) is a named wire DTO
like `RunEvent` (deviation §13). `ChatSessionCreate/View`, `ChatMessageCreate/View` follow the keystone
`*Create/*View` convention.

---

## 7. Screen-by-screen behavior

Visual system/tokens follow the design captures (chat view) and `@gilgamesh/ui`. Below specifies *behavior*.

### 7.1 Chat (`/projects/{id}/chat`)
- **Header** — routed mode shows *Gilgamesh* (pantheon); a pinned session shows the pinned agent's tile
  identity (glyph, deityName, family color). Opened from an agent tile in the Agent room → pinned.
- **Message list** — USER right-aligned; AGENT messages carry the answering deity's attribution (US-1 makes
  the router visible: different questions, different deities); SYSTEM lines render as run-narration blocks.
- **Composer** — send on Enter (CSRF header); disabled while streaming; errors surface inline (`Problem`).
- **Streaming** — the client subscribes to C3 (SSE) per session; answer tokens append live (`DELTA`), tool
  calls render as chips (`TOOL`), an enqueued run renders the narration block that updates from `RUN_NODE`
  events and closes with `RUN_SUMMARY` (link to the run in the Test Lab results panel).
- Loading / empty / error states throughout; reads use `credentials:'include'`.

---

## 8. Acceptance criteria

Each AC has a stable id; every Gherkin scenario is tagged with the AC id it verifies (traceability §11).

### Sessions & messages (`sessions.feature`)
- **AC-CHAT-01** `POST /projects/{id}/chat` creates a `ChatSession` scoped to org+project; an `agentId` pin
  persists when given.
- **AC-CHAT-02** Sending a message persists the `USER` `ChatMessage` and the `AGENT` answer, both
  `orgId`-scoped, ordered by `createdAt`.
- **AC-CHAT-03** Tenant isolation: another org's session returns `404` on send/stream; sessions/messages are
  never visible cross-org (asserted at the DB level).
- **AC-CHAT-04** RBAC: a `VIEWER` creating a session or sending a message → `403`; unauthenticated → `401`.
- **AC-CHAT-05** Pinning an `agentId` not in the org catalog (unknown or foreign) → `422`.
- **AC-CHAT-06** Send is rate-limited per IP+account (cost-bearing endpoint, the AC-GEN-04 pattern) → `429`.

### Routing (`routing.feature`)
- **AC-ROUTE-01** A specialist-flavored message routes to its `AgentSlot` via `AgentBrainPort.complete()` at
  `HAIKU` tier; the answer's `ChatMessage.agentId` is that slot's agent.
- **AC-ROUTE-02** Classification confidence **< 0.6** → the **lead** (Zeus) answers.
- **AC-ROUTE-03** A slot whose `ToolBinding.enabled = false` is excluded from routing → the lead answers.
- **AC-ROUTE-04** A pinned session **skips routing**: the pinned agent answers and no classify call is made,
  regardless of message content.
- **AC-ROUTE-05** The brain is the **stub**: canned responses per slot, deterministic and offline — identical
  input yields identical routing and identical answer text.

### Scoped retrieval (`retrieval.feature`)
- **AC-RET-01** Retrieval filters `orgId` AND (`scope` = agent's slot OR `shared` OR `NULL`): a `sec`-scoped
  chunk **never** grounds a `perf` chat.
- **AC-RET-02** `shared`-scoped and `NULL`-scoped chunks ground **every** agent's retrieval.
- **AC-RET-03** Retrieval is pgvector top-k and org-isolated: another org's chunks are never retrieved.

### Chat-triggered tools & runs (`chat-runs.feature`)
- **AC-CRUN-01** An `enqueue_run` tool call enqueues through the **standard `TriggerRun`** (RBAC + quota +
  audit, slice 3/4 unchanged); the triggering `ChatMessage.runId` is set.
- **AC-CRUN-02** With the quota exhausted, the tool call is rejected `QUOTA_EXCEEDED` (402 semantics), **no
  `Run` persists**, and the chat narrates the rejection.
- **AC-CRUN-03** `RunEvent`s narrate into the chat SSE; the terminal summary persists as a `SYSTEM`
  `ChatMessage` linked by `runId`.
- **AC-CRUN-04** `create_test_case` / `generate_feature` invoke the **existing** slice-2 use cases (the case
  persists / drafts return for review) and are audited; **no tool outside the whitelist of 3 exists**.

---

## 9. Sensitive actions → audit (`AuditLog`)

| action | when | targetType |
|--------|------|------------|
| `chat.session.created` | session create (metadata: pinned slot?) | `ChatSession` |
| `chat.message.sent` | each USER message (metadata: length, routed slot, fallback? — **never** the message text) | `ChatSession` |
| `chat.tool.invoked` | each tool call (metadata: tool key, target id) | `ChatSession` |
| *(reused)* `run.triggered` / `testcase.created` / `testlab.generated` | fired by the underlying slice-2/3 use cases — no double audit | `Run`/`TestCase`/`Project` |

---

## 10. Non-functional requirements

### 10.1 Performance
- **Send → first SSE event (server p95):** **< 500 ms** with the stub (route + retrieve + first delta);
  real-brain budgets belong to the Brain slice. Routing adds at most one `HAIKU` `complete()` call and is
  skipped entirely on pinned sessions.
- **Retrieval:** one tenant-scoped pgvector query, top-k ≤ 8; `KnowledgeChunk.scope` is **indexed** so the
  scope filter does not scan.
- **SSE:** the replay stream is bounded by the session's message count and closes deterministically;
  heartbeat/reconnect semantics arrive with live push (real Brain delivery).

### 10.2 Security (target OWASP ASVS L2)
- **Tenant isolation:** every session/message/chunk query filters by the `orgId` resolved from session →
  `Membership`; a foreign session/project → `404` (never `403`). Pin references validated in-tenant.
- **RBAC:** chat is `MEMBER`+; every tool call executes the **existing use case with the caller's identity**
  — chat NEVER escalates or bypasses RBAC/quota/validation.
- **Prompt safety:** message content is untrusted text — never executed, never interpolated into queries;
  the tool surface is a **closed whitelist of 3**; tool args are validated by the underlying use cases'
  DTO validation. Size cap on `content`; `Problem+json` on violations.
- **CSRF:** C1/C2 require the double-submit `X-CSRF-Token`; C3 (SSE GET) authenticates via the session cookie.
- **Rate limit:** C2 joins `RateLimitGuard` (AC-CHAT-06). Audit records lengths/slots, never message text.

### 10.3 Reliability / consistency
- The `USER` message persists before brain work; a brain/tool failure leaves the USER message + an error
  event on the SSE — no partial `AGENT` rows.
- `enqueue_run` inherits slice-4 atomicity (quota charge + run write in one `UnitOfWork` transaction,
  inside the unchanged `TriggerRun`). **As built:** `ChatMessage.runId` is set immediately after that
  transaction commits (chat never reaches into the standard path's transaction) — a crash in the
  narrow window leaves a valid Run without the chat link, never a dangling link.
- The stub is pure/offline (no `Date.now`/`Math.random`/network): identical inputs → identical outputs.

---

## 11. Traceability matrix (AC → scenario)

| AC | Feature file | Scenario tag |
|----|--------------|--------------|
| AC-CHAT-01 | sessions.feature | `@AC-CHAT-01` Create a session / pinned session |
| AC-CHAT-02 | sessions.feature | `@AC-CHAT-02` Message + answer persist |
| AC-CHAT-03 | sessions.feature | `@AC-CHAT-03` Tenant isolation |
| AC-CHAT-04 | sessions.feature | `@AC-CHAT-04` Viewer cannot chat |
| AC-CHAT-05 | sessions.feature | `@AC-CHAT-05` Foreign/unknown pin rejected |
| AC-CHAT-06 | sessions.feature | `@AC-CHAT-06` Send is rate-limited (@wip, AC-GEN-04 pattern) |
| AC-ROUTE-01 | routing.feature | `@AC-ROUTE-01` Routes to the specialist |
| AC-ROUTE-02 | routing.feature | `@AC-ROUTE-02` Low confidence → lead |
| AC-ROUTE-03 | routing.feature | `@AC-ROUTE-03` Disabled agent → lead |
| AC-ROUTE-04 | routing.feature | `@AC-ROUTE-04` Pinned session skips routing |
| AC-ROUTE-05 | routing.feature | `@AC-ROUTE-05` Deterministic canned answers |
| AC-RET-01 | retrieval.feature | `@AC-RET-01` sec chunk never in a perf chat |
| AC-RET-02 | retrieval.feature | `@AC-RET-02` shared/NULL visible to all |
| AC-RET-03 | retrieval.feature | `@AC-RET-03` Org isolation of retrieval |
| AC-CRUN-01 | chat-runs.feature | `@AC-CRUN-01` Chat run via the standard path |
| AC-CRUN-02 | chat-runs.feature | `@AC-CRUN-02` Quota respected |
| AC-CRUN-03 | chat-runs.feature | `@AC-CRUN-03` RunEvents narrated + SYSTEM summary |
| AC-CRUN-04 | chat-runs.feature | `@AC-CRUN-04` Whitelisted authoring tools |

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Vague / unclassifiable message | lead (Zeus) answers | AC-ROUTE-02 |
| Routed slot disabled in the project | lead answers | AC-ROUTE-03 |
| Every specialist disabled (only lead awake) | lead answers — **lead is the fallback of last resort even if its own `ToolBinding` is disabled** (else chat is dead; flagged §13) | AC-ROUTE-03 |
| Pinned session + off-topic message | pinned agent still answers; no classify call | AC-ROUTE-04 |
| Pin to unknown/foreign agent | `422` | AC-CHAT-05 |
| Empty message / over size cap | `422`; nothing persists | AC-CHAT-04 (validation) |
| Cross-tenant session access | `404` (no existence leak) | AC-CHAT-03 |
| Viewer chats | `403` | AC-CHAT-04 |
| Send flooded | `429` | AC-CHAT-06 |
| `sec`-scoped chunk in a `perf` chat | never retrieved | AC-RET-01 |
| Run requested with quota exhausted | `QUOTA_EXCEEDED` narrated; no `Run` row | AC-CRUN-02 |
| Tool requested outside the whitelist | refused in-chat; no use case invoked | AC-CRUN-04 |
| Brain/tool failure mid-answer | USER message kept; error event on SSE; no partial AGENT row | §10.3 |

---

## 13. Deviations & open questions

**Deviations (introduced names / extensions beyond the keystone):**
- **`ChatEvent`** — the C3 SSE wire DTO (`MESSAGE|DELTA|TOOL|RUN_NODE|RUN_SUMMARY|DONE`), named like
  `RunEvent`; defined by this slice, candidate for a future keystone amendment if other slices consume it.
- **Tool keys `create_test_case` / `generate_feature` / `enqueue_run`** — a slice-level closed registry
  mapping to the EXISTING use cases (`CreateTestCase`, `GenerateDrafts`, `TriggerRun`); they name bindings,
  not entities/routes, so they live here, not in the keystone.
- **`DeterministicBrain` canned-per-slot extension** — extends the existing slice-2 stub adapter with a
  stable slot→answer map + keyword classification; still offline/pure.
- **`SYSTEM` run-summary persistence** — `RunEvent`s stream live (not persisted per-event); only the terminal
  summary persists as a `SYSTEM` `ChatMessage` (history keeps the outcome without duplicating run storage).
- **Router confidence threshold 0.6** — a named constant in the router use case (spec'd here, not keystone).
- **C3 replay semantics (as built)** — the first SSE surface in the codebase; it replays persisted
  messages and closes (`MESSAGE`* + `DONE`). Run narration reaches the stream as the SYSTEM message's
  content (the run completes synchronously inside the send request via `DeterministicKernel`), which is
  how AC-CRUN-03 is satisfied today; per-event live push (`DELTA`/`RUN_NODE`) is the Brain/Orchestration
  follow-up.
- **Tile-pinned entry (web)** — the Agent room's chat action navigates unpinned for now: the room view
  exposes slots but not agent ids. `/projects/{id}/chat?agent=<agentId>` already pins; wiring the tile
  lands with the Chat re-skin (needs agent ids in `ProjectAgentView`). Pinning is fully covered at
  API/BDD level.

**Open questions (non-blocking; defer):**
- **Session list / history read endpoints** — the Chat screen's session rail needs `GET` routes the keystone
  v0.2 deliberately does not define; propose in a follow-up amendment when the screen lands.
- **Lead-disabled fallback** — current spec: the lead answers as last resort even when its own binding is
  disabled. Confirm with the owner if a "everyone asleep → chat off" mode is preferred.
- Should routing confidence persist on `ChatMessage` for analytics? (Currently derived-only.)
- Does chat retrieval also see the slice-5 **global shared corpus** (`orgId IS NULL` rows)? Default: yes —
  same visibility as `GenerateDrafts` grounding today; revisit with the RAG final posture (audit Bloque 3).
