# Slice 9 — Brain (real `AgentBrainPort` adapter) (SDD Spec)

> Spec-Driven-Design spec for the ninth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.3** — this slice
> depends on the v0.3 Brain amendment: `AI_PROVIDERS`/`anthropic`, `BrainSurface`, `BrainUsage`,
> `GET /orgs/{orgId}/brain/usage`).
> v0.1 — 2026-07-05. Status: SPEC — scaffolding (spec + BDD `.feature`s); implementation cycle started.
> Scope: real Claude adapter behind the frozen `AgentBrainPort` + BYOK + metering + live chat SSE + tool
> registry (owner decisions S9-1..6).

---

## 0. Owner decisions S9 (approved 2026-07-05)

1. **Provider key** — platform `ANTHROPIC_API_KEY` (env) as default; **optional per-org BYOK** via
   `Integration` key `anthropic` (group `AI_PROVIDERS`, SecretVault — token verified then DISCARDED, only
   a `secretRef` stored; the S6 pattern). Resolution order per call: **org BYOK → platform key → fallback
   to `DeterministicBrain`**. `BRAIN_MODE=offline` (set by the BDD/int/Playwright harnesses and CI) forces
   the stub regardless — no suite ever calls the network.
2. **Embeddings** — Anthropic has NO embeddings API. `embed()` stays the deterministic lexical hash in S9
   (RAG behavior unchanged); semantic embeddings are a separate decision (second provider — e.g. Voyage —
   + corpus re-ingest + vector migration). The `EMBED` surface is reserved but writes no usage in S9.
3. **Metering** — a `BrainUsage` row per REAL brain call (tier, surface, tokens in/out, cache read/create),
   aggregated by `GET /orgs/{orgId}/brain/usage`. Charging tokens = the 4-tier billing migration, not S9.
4. **Tool use** — a first-class **tool registry** in application (name → arg schema → handler): generates
   the Claude API `tools` definitions, validates incoming args, dispatches. The stub and the real adapter
   consume the SAME registry (closes the S8 review deferral).
5. **Live chat SSE** — implement the frozen `EventBus` port (§5) in-memory; C3 becomes **replay + live**
   (deltas, heartbeat) behind a reusable SSE writer (S8 review deferral). BDD keeps replay assertions.
6. **Models/budgets** — tier→model mapping via config with defaults (HAIKU→`claude-haiku-4-5`,
   SONNET→`claude-sonnet-5`, OPUS→`claude-opus-4-8`), prompt caching via the frozen `cacheKey`, bounded
   timeout+retry, output-token cap. Adapter config, not keystone.

---

## 1. Feature intent

Swap the deterministic stub for the **real Claude adapter** behind the frozen `AgentBrainPort` — same port,
zero UI/domain change — so chat answers, routing and draft generation become real LLM output when a key is
present, while every offline path (CI, BDD, dev without a key) keeps the deterministic stub. Orgs can bring
their own Anthropic key (BYOK) exactly like a repo integration; every real call is **metered** per org into
`BrainUsage` and visible in a usage view; chat gains **live SSE** delta push; tool calling moves onto a
schema-validated **registry** shared by stub and real adapter.

---

## 2. Scope

### In scope
- **`ClaudeBrain` adapter** (apps/api infra) implementing `AgentBrainPort` against the Anthropic Messages
  API: `complete` + `stream` (SSE deltas), tier→model config, prompt caching via `cacheKey`, bounded
  timeout + retry, output-token cap. Unit-tested against a faked HTTP layer; an OPTIONAL manual smoke runs
  only with `BRAIN_SMOKE=1` + a real key (never in CI).
- **Provider selection** — a composing adapter resolving per call: org BYOK secretRef → platform env key →
  `DeterministicBrain`. `BRAIN_MODE=offline` forces the stub (harness/CI default).
- **BYOK** — `anthropic` in the AI_PROVIDERS catalog; connect/disconnect via the existing keystone mutator
  `PATCH /orgs/{orgId}/integrations/anthropic` (verify → `vault.put` → upsert; the raw key never persisted,
  logged, or echoed — S6-B assertions re-applied). Key verification is a port (stubbed offline; a 1-token
  HAIKU ping in prod).
- **Metering** — `BrainUsage` record/repo (both wirings + Prisma migration); usage recorded per real call
  with `surface` (`CHAT`/`ROUTER`/`GENERATE`); `GetBrainUsage` use case + `GET /orgs/{orgId}/brain/usage`
  (member view, per-tier/per-surface aggregate); pure domain aggregation fold.
- **Tool registry** — application registry (name → arg schema → handler) feeding: Claude `tools`
  definitions, arg validation (invalid args → narrated outcome + audited, the underlying use case is NOT
  invoked), and `SendChatMessage.invokeTool` dispatch. Whitelist unchanged (3 tools).
- **Live chat SSE** — in-memory `EventBus`; `SendChatMessage` publishes `DELTA`/`MESSAGE` events; C3
  replays persisted messages then stays subscribed (heartbeat, client disconnect handling) via a reusable
  SSE writer.
- **web** — Billing screen gains an **AI usage** card (per-tier/per-surface totals); Integrations screen
  lists the AI_PROVIDERS group (connect/disconnect reuses the existing flow).

### Out of scope (explicitly deferred)
- **Semantic embeddings** (Voyage/other provider, corpus re-ingest, vector migration) — own decision.
- **Token charging/billing** — the 4-tier billing migration consumes `BrainUsage` later.
- **Voice (STT/TTS), per-agent voices, multi-agent deliberation** — later slices.
- **BYOK for other AI providers** — catalog stays `anthropic` only.
- **Streaming for `GenerateDrafts`** — stays request/response.

---

## 3. Actors / personas

| Actor | Slice-9 capabilities |
|-------|----------------------|
| **Owner / Admin** | Connect/disconnect the `anthropic` BYOK integration; view usage. |
| **Member** | Chat/generate as before (now real when a key exists); view the org's usage. |
| **Viewer** | View usage (read-only org data, like the subscription view); no chat (unchanged S8). |
| **Non-member** | Org usage/integration endpoints → `404`. |
| **Anonymous** | `401`. |

---

## 4. User stories

- **US-1** As a member, my chat/deity answers come from the real model when the workspace has a key —
  same UI, no redeploy.
- **US-2** As an owner, I connect my org's own Anthropic key like any integration; the raw key is never
  stored or shown.
- **US-3** As a member, I see how many tokens my org spent, by tier and by surface.
- **US-4** As a developer/CI, every suite runs offline and deterministic — no key, no network, ever.
- **US-5** As a member, agent answers stream live into the chat instead of arriving on refresh.
- **US-6** As a platform, tool calls are schema-validated before any use case executes — a malformed tool
  call narrates an error, never a 500.

---

## 5. Data contracts touched

| Entity | Slice-9 usage | Key fields |
|--------|---------------|------------|
| **BrainUsage** | **new** — one row per real brain call. | `orgId`, `tier:BrainTier`, `surface:BrainSurface`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreateTokens`, `createdAt`. |
| **Integration** | reuse — the BYOK row. | `key='anthropic'`, `group=AI_PROVIDERS`, `secretRef`(never token), `connected`. |
| **ChatMessage/ChatSession** | unchanged — live SSE rides the S8 records. | — |
| **AuditLog** | §9 actions. | — |

**Derived (not stored):** the per-org usage aggregate (pure domain fold: totals per tier+surface).
**Stub behavior (amended in implementation):** metering is UNCONDITIONAL — the application layer
meters every brain call, stub included (stub rows carry its deterministic length-based counts), so
the metering ACs are BDD-verifiable offline with no special flag. The original `BRAIN_METER_STUB=1`
idea was dropped (see §13).

---

## 6. API operations used (keystone §6, v0.3)

| # | Method + path | Purpose | Response |
|---|---------------|---------|----------|
| B1 | `GET /orgs/{orgId}/brain/usage` | Aggregated usage per tier+surface (+ totals). | `BrainUsageView` |
| B2 | `PATCH /orgs/{orgId}/integrations/anthropic` | Connect/disconnect BYOK (existing mutator, S6). | `IntegrationView` |
| B3 | `GET /chat/{sessionId}/events` | Now replay **+ live** (S8 route, upgraded semantics). | SSE |

---

## 7. Screen behavior

- **Billing (`/billing`)** — an "AI usage" card: total input/output tokens for the org, small per-tier and
  per-surface breakdown; loads from B1; empty state when no usage.
- **Integrations (`/integrations`)** — the AI Providers group renders from the extended catalog; connect
  prompts for the API key (sent once, never rendered back), disconnect clears; identical UX to S6.
- **Chat (`/projects/:id/chat`)** — answers append token-by-token from live `DELTA` events; the composer
  stays disabled until `DONE`; behavior identical when the stub answers (single delta).

---

## 8. Acceptance criteria

### Provider selection (`provider.feature`)
- **AC-BRAIN-01** With no key configured (offline mode), all brain-backed features run on the stub:
  deterministic, identical outputs for identical inputs, no network.
- **AC-BRAIN-02** Provider resolution order is org BYOK → platform key → stub (unit-verified with fakes);
  `BRAIN_MODE=offline` forces the stub even when keys exist.
- **AC-BRAIN-03** A brain failure (adapter error) never 500s chat: the send narrates a brain-unavailable
  outcome and the USER message stays persisted (S8 §10.3 semantics).

### BYOK (`byok.feature`)
- **AC-BYOK-01** `anthropic` appears in the integrations catalog under AI_PROVIDERS.
- **AC-BYOK-02** Connect verifies the key then discards it: only `secretRef` persists; the raw key never
  appears in any row, view, or audit metadata (S6-B assertion re-applied).
- **AC-BYOK-03** Disconnect clears `connected` and the vault entry; OWNER/ADMIN gate; `MEMBER` → 403;
  non-member → 404; audited.

### Metering (`metering.feature`)
- **AC-METER-01** A chat send writes `BrainUsage` rows for its real calls (ROUTER when routed, CHAT for the
  answer), org-scoped with tier + token counts.
- **AC-METER-02** A generate call writes a GENERATE row.
- **AC-METER-03** `GET /orgs/{orgId}/brain/usage` aggregates per tier+surface; any member (incl. VIEWER)
  may read; non-member → 404.
- **AC-METER-04** Usage rows are tenant-isolated: another org's calls never appear in my aggregate.

### Tool registry (`tools.feature`)
- **AC-TOOL-01** The 3 whitelisted tools keep working end-to-end through the registry (S8 regression).
- **AC-TOOL-02** A tool call with schema-invalid args is narrated + audited (`outcome=INVALID_ARGS`) and
  the underlying use case is NOT invoked.
- **AC-TOOL-03** The registry is the single source: the Claude `tools` definitions, the stub's emitted
  intents and the dispatcher all derive from it (unit-verified).
- **AC-TOOL-04** An unknown tool stays refused with no audit row (S8 AC-CRUN-04 unchanged).

### Live SSE (unit/e2e + S8 BDD regression; no new BDD file — see §13)
- **AC-SSE-01** C3 replays persisted messages then stays open, pushing live `DELTA`/`MESSAGE` events with
  heartbeat; closing the client unsubscribes (no leak). Verified at unit/e2e level; BDD keeps asserting
  replay + persistence (112-scenario sweep must stay green).

---

## 9. Sensitive actions → audit (`AuditLog`)

| action | when | targetType |
|--------|------|------------|
| `integration.connected` / `integration.disconnected` (reused S6) | BYOK connect/disconnect (never the key) | `Integration` |
| `chat.tool.invoked` (reused S8, `outcome` gains `INVALID_ARGS`) | every whitelisted tool attempt | `ChatSession` |
| *(no new audit for brain calls — `BrainUsage` IS the record)* | — | — |

---

## 10. Non-functional requirements

- **Determinism/CI:** `BRAIN_MODE=offline` in every harness; the Claude adapter is unit-tested against a
  faked HTTP layer (recorded shapes); zero network in CI. `BRAIN_SMOKE=1` + real key = manual-only smoke.
- **Security:** the API key lives ONLY in env or vault (`secretRef`); never in DB rows, logs, audit
  metadata, error messages, or Views. Prompt/grounding content is untrusted (S8 rules unchanged). Timeout +
  bounded retry + output-token cap bound cost/latency per call.
- **Tenant isolation:** `BrainUsage` queries org-scoped; usage view via `requireOrgAccess`-equivalent
  membership check (non-member 404). BYOK resolution reads only the caller org's integration.
- **Performance:** provider resolution adds ≤1 vault read per call (cacheable); metering is one insert per
  call (indexed `orgId+createdAt`); the usage aggregate is one grouped query.
- **Resilience:** adapter errors map to a narrated outcome in chat and a `VALIDATION`-class Problem in
  generate — never a raw 500; the stub fallback keeps the product usable with no key.

---

## 11. Traceability matrix

| AC | File | Scenario |
|----|------|----------|
| AC-BRAIN-01/02/03 | provider.feature | offline determinism · resolution order (unit) · brain failure narrated |
| AC-BYOK-01/02/03 | byok.feature | catalog · connect discards key · disconnect + RBAC + tenant |
| AC-METER-01/02/03/04 | metering.feature | chat rows · generate row · aggregate view + RBAC · isolation |
| AC-TOOL-01/02/03/04 | tools.feature | regression · invalid args · single-source (unit) · unknown refused |
| AC-SSE-01 | (unit/e2e) | replay+live, heartbeat, unsubscribe |

---

## 12. Edge cases

| Edge case | Expected | AC |
|-----------|----------|-----|
| No key anywhere | stub answers; no usage rows | AC-BRAIN-01 |
| BYOK connected but vault entry missing | fall through to platform key/stub; narrated if none | AC-BRAIN-02/03 |
| Adapter timeout / 429 / 5xx after retries | narrated brain-unavailable; USER message kept | AC-BRAIN-03 |
| Connect with an invalid key | verification fails → `VALIDATION`; nothing stored | AC-BYOK-02 |
| Tool args wrong type/missing | narrated + audited INVALID_ARGS; use case not invoked | AC-TOOL-02 |
| Usage view with zero usage | zeros, 200 | AC-METER-03 |
| SSE client disconnects mid-stream | unsubscribe, no leak; message still persists | AC-SSE-01 |

---

## 13. Deviations & open questions

**Deviations (slice-level names; keystone untouched):**
- **`SelectingBrain`** (provider composite), **`BrainKeyVerifier`** port (offline stub / real ping),
  **`MeteredBrain`** wrapper, **`ChatToolRegistry`** + per-tool arg schemas, **`SseWriter`** helper,
  **`InMemoryEventBus`** (implements the frozen §5 `EventBus`).
- **Streamed-call usage:** the frozen `stream()` yields only `{delta}`; the adapter exposes an OPTIONAL
  slice-level extension (`streamWithUsage`) that also resolves final usage; `SendChatMessage`
  feature-detects it for CHAT metering. Folded into the port at the next keystone major.
- **Metering is unconditional** (supersedes the earlier `BRAIN_METER_STUB=1` idea, which was
  dropped): the application layer meters every brain call — stub included — so the metering ACs
  are BDD-verifiable offline with no extra flag; stub rows are free length-based counts.
- **Config env vars:** `ANTHROPIC_API_KEY`, `BRAIN_MODE` (`auto`|`offline`), `BRAIN_SMOKE`, model-id
  overrides per tier.

**Open questions (non-blocking):**
- Usage retention/rollup (raw rows forever vs daily rollup) — revisit with billing.
- Whether the usage view needs a period selector (S9: current calendar month only).
- Per-org spending caps/alerts — billing migration territory.
