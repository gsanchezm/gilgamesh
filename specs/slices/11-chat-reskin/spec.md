# Slice 11 — Chat re-skin (capture 07 + history + live streaming + tile-pinned entry) (SDD Spec)

> Spec-Driven-Design spec for the eleventh vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.4** — this slice
> depends on the v0.4 amendment: `GET /projects/{id}/chat` list + `GET /chat/{sessionId}/messages` history).
> v0.1 — 2026-07-06. Status: IN PROGRESS on branch `slice-11-chat-reskin`.
> Scope: the Chat view re-skin (capture 07) with **real session history**, **live SSE streaming in the
> client**, and the **tile-pinned entry** from the Agent room.

---

## 0. Owner decisions S11

Owner picked **Chat re-skin** as slice 11 (2026-07-06); the keystone was amended to **v0.4** first, in
series on `main` (ORCHESTRATION_PLAN rule 2), adding the two chat **read** routes this slice needs.
Decisions:

- **S11-1 — v0.4 read routes.** The session rail and history browser ride the two new keystone routes:
  `GET /projects/{id}/chat` (list `ChatSession`s, newest-first) and `GET /chat/{sessionId}/messages`
  (conversation history as JSON). This closes the S8 §13 open question "Session list / history read
  endpoints".
- **S11-2 — live EventSource client.** The web chat subscribes to the EXISTING slice-9 live SSE
  (`GET /chat/{sessionId}/events?live=1`, same-origin cookies) via `new EventSource(...)`, listening for
  `MESSAGE`/`DELTA`/`DONE`: deltas append live to a pending answer bubble; `DONE` closes the per-send
  stream. This **replaces the O(n²) full-replay-per-send** (S8 deferral): history loads **once** via
  `GET /chat/{sessionId}/messages`; live events append. When `EventSource` errors, the client falls back
  to a one-shot history resync.
- **S11-3 — tile-pinned entry.** The Agent room's per-agent "Chat" action navigates to
  `/projects/{pid}/chat?agent=<agentId>` and the session opens **pinned** (S8 AC-ROUTE-04 semantics).
  This needs the agent **id** in the room view: `ProjectAgentView` (keystone §6 = "Agent + per-project
  ToolBinding + derived AgentRuntimeStatus") now carries `Agent.id` end to end (application → api → web).
- **S11-4 — visual target.** The prototype's chat view (`design_handoff_gilgamesh/prototipos/
  "Gilgamesh - Prototipo.dc.html"`, `isChat` block) + capture `07-chat-voz.png`: pinned header (back link,
  `AgentAvatar`, deity name, role chip, status · tool line), agent bubbles left with avatar
  (radius 4/14/14/14), user bubbles right in navy `#16335C` (radius 14/4/14/14), centered 880px column,
  round send button, footer line "Answers from your private knowledge base.". **Voice controls are out of
  scope** (the mic affordance renders disabled — the voice slice is deferred); the **session rail** is a
  slice-11 addition the prototype lacks (its chats were per-agent ephemera; ours persist).

---

## 1. Feature intent

Give the chat its real face: a member opens Chat and sees **past conversations** (newest first, titled by
what they asked), reopens any of them with **full history**, starts a **new chat**, watches the answer
**stream live** into the conversation, and reaches a **specific deity directly** from its Agent-room tile.
No behavior of S8/S9 send/route/retrieve/tools changes — this slice adds the two read routes and the
client experience on top.

---

## 2. Scope

### In scope
- **List sessions** — `GET /projects/{id}/chat`: the project's `ChatSession`s **newest-first**
  (`updatedAt` desc, `id` desc tiebreak). Each row: `id`, `agentId`, `createdAt`, `updatedAt`, and a
  derived **`title`** — the session's first `USER` message, whitespace-trimmed, truncated to **60 chars**
  (`null` when the session has no `USER` message yet). Backed by an **efficient batched first-message
  lookup** (`ChatMessageRepository.firstUserMessageBySession`), never one query per session.
- **History** — `GET /chat/{sessionId}/messages`: the conversation as a **JSON array** of
  `ChatMessageView` in conversation order (`createdAt` asc, `id` asc tiebreak). Reuses the EXISTING
  `GetChatEvents` use case (same authz + data as the SSE replay) — no new use case.
- **Live streaming (web)** — S11-2 above: per-send `EventSource` on `?live=1`, `DELTA` → pending bubble,
  `MESSAGE` appends (deduped by id against loaded history), `DONE` closes; error → history resync.
- **Chat screen re-skin (web)** — S11-4: session rail (titles newest-first + "New chat"), conversation
  pane with **deity attribution** (`AgentAvatar` + deityName resolved from the room view by `agentId`),
  run-narration **console cards** for `SYSTEM` messages, prototype composer; **pinned header** when
  `?agent=` is present.
- **Tile-pinned entry (web)** — S11-3: room view exposes agent ids; the tile's Chat action deep-links
  `?agent=<agentId>`; the session creates **pinned** (closes the S8 §13 "tile-pinned entry" deviation).
- Cross-cutting: per-`orgId` tenant isolation (foreign → `404`), RBAC (chat is `MEMBER`+ end to end, S8 —
  a `VIEWER` gets `403` on both reads), `Problem+json` errors, **both persistence wirings** (in-memory +
  Prisma; `chat_sessions` already carries the `(project_id, updated_at desc)` index — no migration).

### Out of scope (explicitly deferred)
- **Voice** — STT/TTS, per-agent voices, the listening waveform (the mic affordance is disabled).
- **Session delete/rename**, message edit, attachments, cross-project sessions, pagination of the
  session list (pagination is its own audit follow-up slice).
- **Run-narration live `RUN_NODE` push** — runs still complete synchronously inside the send
  (`DeterministicKernel`); per-node live push is Orchestration (keystone §7 `BLOCKED-UNTIL-DELIVERED`).
- Any change to send/routing/retrieval/tools (S8) or metering/BYOK (S9).

---

## 3. Actors / personas

| Actor | Description | Slice-11 capabilities |
|-------|-------------|----------------------|
| **Owner / Admin / Member** (`OWNER`/`ADMIN`/`MEMBER`) | Chat authors (S8). | List their project's sessions, read history, chat with live streaming, pinned tile entry. |
| **Viewer** (`VIEWER`) | Read-only member. | **Cannot** list sessions or read history (`403`) — chat is `MEMBER`+ end to end (S8 §10.2; conversations may embed tool outcomes). |
| **Anonymous** | Not authenticated. | No access (`401`). |

---

## 4. User stories

- **US-1** As a member, I open Chat and see my past conversations for this project, newest first, titled
  by what I asked — so I can pick up where I left off.
- **US-2** As a member, I reopen a conversation and the full history renders in order.
- **US-3** As a member, I watch the deity's answer stream into the conversation as it is generated.
- **US-4** As a member, I click "Chat" on Thor's tile and I am talking to Thor — pinned, no routing.
- **US-5** As a member, I start a fresh conversation with the "New chat" button without losing the old ones.
- **US-6** As a tenant, none of my sessions/messages is ever listable or readable by another tenant.

---

## 5. Data contracts touched

All fields/types are authoritative from keystone §2/§1 (v0.4). **No schema change, no migration.**

| Entity | Slice-11 usage | Key fields exercised |
|--------|---------------|----------------------|
| **ChatSession** | read — list per project newest-first. | `projectId`, `agentId?`, `createdAt`, `updatedAt` (bumped on send since S8). |
| **ChatMessage** | read — history + batched first-`USER`-message title lookup. | `sessionId`, `role`, `agentId?`, `content`, `runId?`, `createdAt`. |
| **Agent** | read — room view now exposes `id` (S11-3); web resolves `agentId` → deity identity. | `id`, `slot`, `deityName`, `family`, `glyph`. |
| **Project / Membership** | read — tenant + RBAC resolution (`requireProjectAccess`). | `orgId`, `role`. |

**Derived (not stored):** the session list `title` (first `USER` message trimmed to 60 chars — §13
deviation); the web's `agentId → deity` attribution map (from the room view).

---

## 6. API operations used (keystone §6, v0.4)

Base path `/api/v1`. Auth via httpOnly session cookie; reads carry no CSRF. Errors are `Problem+json`.
Tenant resolved from session → active `Membership.orgId`; a foreign project/session returns `404`.

| # | Method + path | Purpose | Request DTO | Response DTO |
|---|---------------|---------|-------------|--------------|
| L1 | `GET /projects/{id}/chat` | List the project's `ChatSession`s newest-first. | — | `ChatSessionListItemView[]`* |
| H1 | `GET /chat/{sessionId}/messages` | Conversation history in order. | — | `ChatMessageView[]` |
| *(reused)* C1/C2 | `POST /projects/{id}/chat` · `POST /chat/{sessionId}/messages` | S8 unchanged. | | |
| *(reused)* C3 | `GET /chat/{sessionId}/events?live=1` | S9 live SSE — now consumed by the web `EventSource`. | | SSE of `ChatEvent` |

\* `ChatSessionListItemView` = `{ id, agentId, createdAt, updatedAt, title }` — the keystone `*View`
convention over `ChatSession` plus the derived `title` (§13).

---

## 7. Screen-by-screen behavior

### 7.1 Chat (`/projects/{id}/chat[?agent=<agentId>]`) — capture 07
- **Session rail (left)** — the L1 list: each row shows the derived `title` (fallback "New conversation")
  + relative recency; newest first; the active session is highlighted; a **"New chat"** button clears the
  active session (the next send lazily creates one — S8 behavior kept). Hidden on `?agent=` entry? No —
  always visible; a pinned entry simply starts a new pinned conversation.
- **Header** — with `?agent=`: back link "← Agents" (to the room), the pinned agent's `AgentAvatar`
  (portrait, family frame, status dot), deityName (Marcellus), role chip, "status · tool" mono line —
  the capture-07 header. Without a pin: the Gilgamesh pantheon header ("Agent chat", routed subtitle).
- **Conversation pane** — centered 880px column. `USER` right-aligned navy bubbles; `AGENT` left bubbles
  with the answering deity's `AgentAvatar` + name (attribution resolved by `agentId` from the room view —
  different questions, different deities); `SYSTEM` messages render as full-width mono **console cards**
  (run narration). While streaming, a **pending bubble** fills from `DELTA` events.
- **Composer** — prototype-faithful: rounded input ("Type a message…" placeholder), round gold mic button
  **disabled** (voice deferred), round navy send button; footer mono line "Answers from your private
  knowledge base.". Send on Enter; disabled while streaming; errors inline (`Problem`).
- **Live flow** — on send: ensure session (lazy create, pin from `?agent=`) → open
  `EventSource('/api/v1/chat/{id}/events?live=1')` → POST the message → append `DELTA`s to the pending
  bubble → replace it with the persisted `AGENT` `MESSAGE` → close on `DONE`. `EventSource` error →
  close + resync via H1. History loads once per session select via H1 — never re-replayed per send.
- Loading / empty / error states throughout; reads use `credentials:'include'`.

---

## 8. Acceptance criteria

Each AC has a stable id; every Gherkin scenario is tagged with the AC id it verifies (traceability §11).

### Session list & history (`chat-reskin.feature`)
- **AC-CRS-01** `GET /projects/{id}/chat` returns the project's sessions **newest-first** (`updatedAt`
  desc, `id` desc tiebreak); each row carries `id`, `agentId`, `createdAt`, `updatedAt` and the derived
  `title` (first `USER` message trimmed to ≤ 60 chars; `null` when the session has no `USER` message).
- **AC-CRS-02** Sending a message **bumps the session to the top** of the list (the S8 `touch` on
  `updatedAt` is what the ordering rides on).
- **AC-CRS-03** `GET /chat/{sessionId}/messages` returns the conversation as a JSON array in
  conversation order (`USER` then `AGENT` then any `SYSTEM`), with `role`/`agentId`/`content`/`runId`.
- **AC-CRS-04** Tenant isolation: a foreign org listing my project's sessions or fetching my session's
  history gets `404` (never `403` — no existence leak); my list never contains another org's sessions.
- **AC-CRS-05** RBAC: a `VIEWER` gets `403` on both reads; unauthenticated gets `401` (regression pin:
  chat is `MEMBER`+ end to end, S8).
- **AC-CRS-06** Tile-pinned entry: a session created with an **agent id taken from the room view**
  persists that pin, and the pinned session appears in the list with its `agentId` (regression re-pin of
  S8 AC-CHAT-01/AC-ROUTE-04 through the new id plumb).

---

## 9. Sensitive actions → audit (`AuditLog`)

**None new.** Both routes are reads (list/history) — same audit posture as the S8 SSE replay (reads are
not audited; sends/tools keep their S8 rows unchanged).

---

## 10. Non-functional requirements

### 10.1 Performance
- **List:** one indexed query (`chat_sessions (project_id, updated_at desc)` exists since S8) + **one**
  batched first-message lookup for the titles (`firstUserMessageBySession(sessionIds)`) — never N+1.
- **History:** one indexed query (`chat_messages (session_id, created_at)`).
- **Web:** history loads once per session select; live events append — the S8 O(n²)
  full-replay-per-send is gone. The `EventSource` is per-send and closed on `DONE` (no idle sockets).

### 10.2 Security (target OWASP ASVS L2)
- **Tenant isolation:** both reads resolve the session's/project's org and pass `requireProjectAccess`;
  foreign → `404`. The list is scoped by `projectId` **after** access is proven.
- **RBAC:** both reads are `MEMBER`+ (`VIEWER` → `403`) — conversations can embed tool outcomes.
- **CSRF:** reads are cookie-authenticated GETs (no CSRF header needed — same posture as C3);
  mutations keep the S8 double-submit.
- Message `content` remains untrusted display text (React-escaped; never interpolated).

### 10.3 Reliability / consistency
- The title derivation is read-only and deterministic (first `USER` message by `createdAt` asc, `id`
  asc tiebreak — UUID v7 keeps same-ms ties in creation order; in-memory ↔ Prisma parity pinned by tests).
- A live-stream failure never loses data: messages persist server-side first (S8 §10.3); the client
  falls back to the H1 resync.

---

## 11. Traceability matrix (AC → scenario)

| AC | Feature file | Scenario tag |
|----|--------------|--------------|
| AC-CRS-01 | chat-reskin.feature | `@AC-CRS-01` List newest-first with derived titles / title trim / null title |
| AC-CRS-02 | chat-reskin.feature | `@AC-CRS-02` Activity bumps a session to the top |
| AC-CRS-03 | chat-reskin.feature | `@AC-CRS-03` History returns the conversation in order |
| AC-CRS-04 | chat-reskin.feature | `@AC-CRS-04` Tenant isolation on list + history |
| AC-CRS-05 | chat-reskin.feature | `@AC-CRS-05` Viewer blocked on both reads |
| AC-CRS-06 | chat-reskin.feature | `@AC-CRS-06` Tile-pinned session appears pinned in the list |

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Session with no messages yet | listed with `title: null` (web renders "New conversation") | AC-CRS-01 |
| First USER message > 60 chars | title = first 60 chars (no server ellipsis) | AC-CRS-01 |
| Two sessions touched in the same millisecond | `id` desc tiebreak (UUID v7 = creation order) | AC-CRS-01 |
| Empty project (no sessions) | `200 []` | AC-CRS-01 |
| Foreign project list / foreign session history | `404`, no existence leak | AC-CRS-04 |
| Viewer lists/reads | `403` | AC-CRS-05 |
| Unauthenticated | `401` | AC-CRS-05 |
| Unknown `sessionId` history | `404` | AC-CRS-04 |
| `EventSource` unsupported/error mid-stream (web) | close + one-shot H1 resync; conversation stays consistent | §10.3 |
| `?agent=` id not in the org catalog | session create rejects `422` (S8 AC-CHAT-05 unchanged); the screen surfaces the Problem inline | AC-CRS-06 |

---

## 13. Deviations & open questions

**Deviations (introduced names / extensions beyond the keystone):**
- **`ChatSessionListItemView.title`** — a slice-level **derived view field** (first `USER` message,
  trimmed, ≤ 60 chars; `null` when absent). The keystone `ChatSession` entity is untouched — nothing is
  stored; candidate for a keystone `*View` note if other slices consume it.
- **`ChatSessionRepository.listForProject(projectId)`** + **`ChatMessageRepository.
  firstUserMessageBySession(sessionIds)`** — repository-port extensions (keystone §5 lists repositories
  per aggregate without freezing method sets; both implemented in-memory + Prisma with order parity).
- **`ProjectAgentView.id`** — the room view now exposes `Agent.id` (application `AgentRoomAgentView` →
  api → web). Keystone-conformant (§6 defines the view as "Agent + ToolBinding + status", and `id` is an
  `Agent` field) — noted because the field was previously omitted.
- **Session-rail UI** — a screen affordance the prototype lacks (its chats were per-agent, in-memory);
  required by persisted history. Visual language follows the capture-07 system.
- **Disabled mic affordance** — rendered for capture fidelity, inert until the voice slice.

**Open questions (non-blocking; defer):**
- Session **rename/delete** and list **pagination** — pagination is already an audit Bloque-3 follow-up;
  revisit together.
- Should the title fall back to the pinned agent's deityName instead of `null` for pinned sessions?
  (Web currently renders "New conversation".)
