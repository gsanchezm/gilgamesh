# Gilgamesh — Run Lifecycle (runtime spec)

> Scope: the end-to-end life of a **Run** — from `POST /projects/{id}/runs` (enqueue) through DAG
> planning, parallel execution against the owner's **chaos-proxy**, the `RunEvent` stream over an
> **EventBus (Observer)**, artifact persistence, report persistence, and final `Run`/`RunNode` row
> updates. Names, enums, entities and port signatures are taken **verbatim** from the Foundation
> Keystone (`specs/_keystone/foundation-vocabulary.md`). Where the keystone leaves a shape implicit
> (e.g. `PlanNode`), this doc resolves it minimally and flags it under **Deviations**.
> Companion: `packages/kernel/CONTRACT.md` (the `TestKernel` port + chaos-proxy adapter + external
> dependency contract). v0.1 — 2026-06-29.

---

## 0. Actors & components (all under the platform monorepo)

| Component | Package / app | Role in the lifecycle |
|-----------|---------------|------------------------|
| Run controller | `apps/api` (NestJS) | Enqueue, status, cancel, report, SSE endpoints. Resolves tenant `orgId`, RBAC, quota. |
| Run queue | Redis + **BullMQ** | Durable at-least-once handoff of runs to workers. Queue name `runs`. |
| Run worker | `apps/workers` | Dequeues a run, drives `TestKernel`, consumes the `RunEvent` stream, persists, publishes. |
| Test kernel | `@gilgamesh/kernel` | `TestKernel` port + chaos-proxy **gRPC adapter** + `AgentPluginRegistry`. The capability seam. |
| chaos-proxy | **external** (owner) | gRPC server `:50051`; resolves locators, routes `ExecuteIntent`→`IntentResult` to plugin servers. |
| EventBus | Redis **Streams** | `EventBus` port impl. One stream per run: `run:{runId}:events`. Durable, replayable fan-out. |
| Artifact storage | Blob (MinIO local / Azure Blob) | `ArtifactStorage` port. Private; access only via **signed expiring URLs**. |
| Database | Postgres (+pgvector) | `Run`, `RunNode`, `Artifact` rows; report aggregates; `Subscription` quota/usage. |

> Process boundary that drives the design: the **SSE endpoint lives in `apps/api`** while execution
> lives in **`apps/workers`**. Events therefore MUST cross a process boundary → an out-of-process
> EventBus (Redis Streams), never an in-process `EventEmitter`.

---

## 1. Lifecycle at a glance

```
POST /projects/{id}/runs                 (1) ENQUEUE  — Run row QUEUED, BullMQ job (jobId=runId)
        │
        ▼
BullMQ `runs` queue  ──►  Run worker      (2) DEQUEUE  — claim job, Run → RUNNING
        │
        ▼
TestKernel.plan(input) → RunPlan          (3) PLAN     — __dispatch → stages-by-deps → __consolidate
        │                                              waves[] = nodes per level = parallel lanes
        ▼
persist RunNode rows (state=IDLE)         (4) MATERIALIZE plan into DAG rows
        │
        ▼
TestKernel.run(plan) → AsyncIterable      (5) EXECUTE  — wave-by-wave, ≤ laneLimit in flight,
        │  RunEvent                                     each STAGE → chaos-proxy via plugin
        ▼
for each RunEvent  ──► Observers:         (6) FAN-OUT  — Observer model (see §4)
   • Persist observer   → DB / Blob
   • Broadcast observer → EventBus (Redis Stream)
   • Metrics observer   → counters/budgets
        │
        ▼
GET /runs/{id}/events  (SSE)              (7) STREAM   — API tails the Stream → browser/mobile
        │
        ▼
SUMMARY event → Run aggregates + report   (8) FINALIZE — Run → DONE | FAILED | CANCELED,
artifacts already in Blob (signed URLs)               finishedAt, durationMs, progress=100,
                                                       Subscription.runMinutesUsed += duration
```

The **only** wired execution adapter is the real chaos-proxy (decision #4 — no product MockRunner).
A contract **test double** exists for CI only; it is never wired in any product environment (see
`packages/kernel/CONTRACT.md` §7).

---

## 2. Stage-by-stage detail

### (1) Enqueue — `POST /projects/{id}/runs`
Controller in `apps/api`. Synchronous, must be fast (budget §8).

1. **AuthN/Z**: resolve `orgId` from the session cookie; require membership `Role ∈ {OWNER, ADMIN, MEMBER}`
   (`VIEWER` cannot trigger runs). Verify the `Project` belongs to `orgId` (tenant isolation — every
   query filtered by `orgId`).
2. **Quota gate**: load `Subscription` for `orgId`; reject `402`-style `Problem` if
   `runMinutesUsed >= runMinutesQuota` or `status ∉ {TRIALING, ACTIVE}`.
3. **Idempotency**: read optional `Idempotency-Key` header. Look up `(orgId, idempotencyKey)`; if a `Run`
   already exists, return it (same `runId`, `200`) instead of creating a new one. Also used to make
   client retries safe (§6).
4. **Validate body** (`RunCreate` DTO): `mode: RunMode` (`BDD|STEPS`), `trigger: RunTrigger`
   (`MANUAL|CI|SCHEDULE`), `selectedStages: string[]` (stage keys the user toggled on the canvas),
   optional `commitSha`, `runLabel`. Reject empty `selectedStages`.
5. **Create `Run` row**: `status=QUEUED`, `progress=0`, `mode`, `trigger`, `selectedStages`, `runLabel`,
   `commitSha?`, `createdById`, `orgId`, `projectId`. (No `RunNode` rows yet — those are produced by
   `plan()` in step 3.)
6. **Enqueue BullMQ job** on queue `runs` with **`jobId = runId`** (dedup — a given run is enqueued at most
   once), payload `{ runId, orgId, projectId }`, `attempts=3`, exponential backoff, `removeOnComplete`
   bounded. Job options carry no secrets.
7. **Respond `202 Accepted`** with `{ runId }` and `Location: /api/v1/runs/{runId}`. The client then opens
   `GET /runs/{runId}/events` (SSE) to follow progress.

### (2) Dequeue — Run worker
BullMQ `Worker` in `apps/workers`, `concurrency = RUNNER_CONCURRENCY` per pod (§8). On job pickup:

1. Re-load `Run` (filter by `orgId` from job payload). If `status ∉ {QUEUED, RUNNING}` → ack & exit
   (already terminal; idempotent no-op). If `status=RUNNING` → this is a **retry/resume** (§6).
2. Resolve **laneLimit** from `Subscription.plan`: `TEAM→3`, `PRO→10`, `ENTERPRISE→∞` (practical cap
   `ENT_LANE_HARD_CAP`, §8). This is the per-run parallel-lane width.
3. Build `StageSpec[]` from the project's selected stages: for each `selectedStages[k]` resolve
   `{ key, slot: AgentSlot, tool: string, feature?, deps: string[] }` from the project's stage config
   (the Test Lab / canvas definition). `slot`+`tool` later resolve to a registered `AgentPlugin`.
4. Set `Run.status=RUNNING`, `startedAt=now`.

### (3) Plan — `TestKernel.plan(input) → RunPlan`
Pure, deterministic function (no I/O) → easy to unit-test, safe to recompute on retry.

```
RunPlanInput = { runId, projectId, mode: RunMode, stages: StageSpec[] }
RunPlan      = { runId, nodes: PlanNode[], waves: string[][] }
```

DAG construction (matches keystone §5 comment and prototype §5):
- **`__dispatch`** — `kind=DISPATCH`, `slot=lead` (Zeus, "resolve & dispatch"), `level=0`, `deps=[]`.
- **STAGE nodes** — one per `StageSpec`. `kind=STAGE`, carry `slot`, `tool`, `feature?`, `sliceId?`.
  `deps` = the stage's `deps` **plus** an implicit dep on `__dispatch`.
  `level = 1 + max(level of each dep)` (a stage with no explicit deps sits at `level=1`).
- **`__consolidate`** — `kind=CONSOLIDATE`, `slot=lead` (Zeus, "consolidate & report"),
  `level = 1 + max(level of all STAGE nodes)`, `deps =` all **leaf** stages (stages no other stage
  depends on). Every leaf connects to consolidate.
- **`waves`** — `nodes` grouped by `level`, ascending. `waves[L]` is the set of node keys at level `L`;
  **all nodes in a wave are eligible to run in parallel** = "parallel lanes". Wave 0 is `[__dispatch]`;
  the last wave is `[__consolidate]`.

`PlanNode` (shape resolved here — see Deviations) mirrors the planning-relevant subset of the `RunNode`
entity:
```ts
type PlanNode = {
  key: string; kind: RunNodeKind;            // DISPATCH | STAGE | CONSOLIDATE
  slot?: AgentSlot; tool?: string;           // STAGE carries both; DISPATCH/CONSOLIDATE → slot=lead
  feature?: string; sliceId?: string;
  level: number; deps: string[];
};
```

### (4) Materialize — persist `RunNode` rows
For each `PlanNode`, upsert a `RunNode` row (`orgId`, `runId`, `key`, `kind`, `level`, `deps`,
`state=IDLE`; for STAGE nodes resolve `slot`→`agentId` from the per-Org `Agent` catalog, set `tool`,
`feature`, `sliceId`). Upsert key = `(runId, key)` so re-materialization on retry is idempotent.

### (5) Execute — `TestKernel.run(plan) → { runId, events: AsyncIterable<RunEvent> }`
The kernel adapter drives execution **wave by wave** (topological order is guaranteed by levels):

```
for wave in plan.waves:                       # waves are already level-ordered
    runNodes(wave, concurrency = laneLimit):  # semaphore caps in-flight nodes at the tier limit
        DISPATCH/CONSOLIDATE → kernel internal (resolve targets / aggregate); fast, no SUT call
        STAGE → registry.resolve(slot, tool) → AgentPlugin
             → build ExecuteIntent{ intentId, payload, locatorKey?, platform, viewport? }
             → chaos-proxy.sendIntent(...) (gRPC :50051) → IntentResult{ status, payload, metrics }
    if any node DONE_FAIL and stage policy = fail-fast → cancel remaining waves (still emit SUMMARY)
```

- **laneLimit** is supplied to the adapter at construction (`createTestKernel({ chaosProxyEndpoint,
  maxLanes })`) — it is **policy/config**, not part of the frozen `run(plan)` signature, so the port stays
  frozen. A wave wider than `laneLimit` is executed in sub-batches of `laneLimit`.
- Each STAGE node emits, in order: `NODE_STATE QUEUED → RUNNING → DONE_PASS|DONE_FAIL`, interleaved
  `LOG` lines (`sys|run|pass|fail|log`) and `ARTIFACT` events. After the last wave, the kernel emits one
  terminal `SUMMARY`.
- `IntentResult.status` maps to node outcome: `PASS→DONE_PASS`, `FAIL→DONE_FAIL`,
  `ERROR→DONE_FAIL` + a `LOG level='fail'` carrying the error (an `ERROR` from the kernel/chaos-proxy is
  an execution fault, distinct from a test `FAIL`; it drives `Run.status=FAILED` in §8).

### (6) Fan-out — Observers consume each `RunEvent`
The worker iterates the `AsyncIterable<RunEvent>` and dispatches every event to the registered observers
(§4). Persistence and broadcast are independent so a slow DB never blocks the live stream:
- **Persist observer**: `NODE_STATE`→update `RunNode.state/startedAt/finishedAt/durationMs`;
  `ARTIFACT`→ensure blob stored + create `Artifact` row; `SUMMARY`→update `Run` aggregates + report.
- **Broadcast observer**: `EventBus.publish('run:{runId}:events', event)` → `XADD` to the Redis Stream.
- **Metrics observer**: increments fan-out latency / runner-concurrency counters (budgets §8).

### (7) Stream — `GET /runs/{id}/events` (SSE) → UI
See §5. The API process tails `run:{runId}:events` and relays `RunEvent`s as Server-Sent Events to the
browser (DAG canvas) and mobile.

### (8) Finalize — report + `Run`/`RunNode` rows
On the terminal `SUMMARY` event (or cancellation/fault):
- Write `Run` aggregates from `SUMMARY`: `passed`, `failed`, `skipped`, `total`, `ratePct`, `durationMs`,
  `progress=100`, `finishedAt=now`.
- **Status resolution**:
  - `DONE` — DAG executed to `__consolidate`. Test `failed > 0` does **not** make the run `FAILED`; the
    failures live in the counts. ("Run completed; some cases failed.")
  - `FAILED` — execution itself faulted (a node `ERROR`, chaos-proxy/plugin unreachable, plan error) so the
    DAG could not complete.
  - `CANCELED` — operator cancellation landed before `__consolidate` (§7).
- Persist `ReportView` (served by `GET /runs/{id}/report`); optionally a `REPORT_HTML` `Artifact`.
- Meter usage: `Subscription.runMinutesUsed += ceil(durationMs / 60000)` (per-tenant cost cap).
- `AuditLog`: `action=RUN_COMPLETED` (or `RUN_CANCELED`/`RUN_FAILED`), `targetType=Run`, `targetId=runId`.
- Emit a final `LOG level='sys'` ("Run {status}") so late SSE subscribers see closure, then the stream is
  marked complete (Redis Stream gets a sentinel; API closes the SSE connection).

---

## 3. Sequence diagram (ASCII)

```
Browser/Mobile      API (NestJS)        BullMQ/Redis      Worker            TestKernel(adapter)   chaos-proxy(:50051)   Blob        EventBus(Redis Stream)   Postgres
   (DAG canvas)     apps/api            queue `runs`      apps/workers      @gilgamesh/kernel     external(owner)       storage     run:{id}:events          DB
      │                 │                    │                │                   │                     │                 │               │                    │
      │ POST /projects/{id}/runs            │                │                   │                     │                 │               │                    │
      │────────────────►│                   │                │                   │                     │                 │               │                    │
      │                 │ authZ + quota + idempotency        │                   │                     │                 │               │                    │
      │                 │───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────►│ INSERT Run(QUEUED)
      │                 │ add job(jobId=runId)│                │                   │                     │                 │               │                    │
      │                 │──────────────────►│                 │                   │                     │                 │               │                    │
      │ 202 {runId}     │                    │                │                   │                     │                 │               │                    │
      │◄────────────────│                    │                │                   │                     │                 │               │                    │
      │                 │                    │  deliver job   │                   │                     │                 │               │                    │
      │                 │                    │───────────────►│ Run→RUNNING       │                     │                 │               │                    │
      │                 │                    │                │──────────────────────────────────────────────────────────────────────────────────────────────►│ UPDATE Run(RUNNING)
      │ GET /runs/{id}/events (SSE)          │                │ plan(input)       │                     │                 │               │                    │
      │════════════════►│ subscribe(run:{id})│                │──────────────────►│ build DAG (pure)    │                 │               │                    │
      │                 │───────────────────────────────────────────────────────────────────────────────────────────────────────────────│ XREAD BLOCK (tail) │
      │                 │                    │                │◄──────RunPlan─────│                     │                 │               │                    │
      │                 │                    │                │ INSERT RunNode[] (IDLE) ─────────────────────────────────────────────────────────────────────►│
      │                 │                    │                │ run(plan)         │                     │                 │               │                    │
      │                 │                    │                │──────────────────►│ wave 0: __dispatch  │                 │               │                    │
      │                 │                    │                │   RunEvent NODE_STATE(__dispatch,RUNNING)│                 │               │                    │
      │                 │                    │                │◄──────────────────│                     │                 │               │                    │
      │                 │                    │                │ Observers: persist + publish ────────────────────────────────────────────►│ XADD event         │──► UPDATE RunNode
      │  event: NODE_STATE (canvas updates)  │◄═══════════════════════════════════════════════════════════════════════════════════════════│ (API tails)        │
      │◄════════════════│                    │                │                   │                     │                 │               │                    │
      │                 │                    │                │ wave 1..N: ≤ laneLimit STAGE nodes in parallel              │               │                    │
      │                 │                    │                │──────────────────►│ resolve(slot,tool)→plugin             │               │                    │
      │                 │                    │                │                   │ sendIntent(ExecuteIntent)             │               │                    │
      │                 │                    │                │                   │────────────────────►│ run on SUT      │               │                    │
      │                 │                    │                │                   │◄────IntentResult─────│ + telemetry     │               │                    │
      │                 │                    │                │   RunEvent LOG / ARTIFACT / NODE_STATE   │                 │               │                    │
      │                 │                    │                │◄──────────────────│                     │                 │               │                    │
      │                 │                    │                │ ARTIFACT → put(storageKey) ─────────────────────────────►│ store blob     │                    │
      │                 │                    │                │ Observers: persist Artifact row + publish ────────────────────────────────►│ XADD event         │──► INSERT Artifact
      │  event: ARTIFACT/LOG (live log)      │◄═══════════════════════════════════════════════════════════════════════════════════════════│                    │
      │◄════════════════│                    │                │                   │                     │                 │               │                    │
      │                 │                    │                │ wave N: __consolidate → SUMMARY          │                 │               │                    │
      │                 │                    │                │◄──────SUMMARY─────│                     │                 │               │                    │
      │                 │                    │                │ Run aggregates + ReportView ─────────────────────────────────────────────────────────────────►│ UPDATE Run(DONE)
      │                 │                    │                │ publish SUMMARY + sys close ──────────────────────────────────────────────►│ XADD SUMMARY+end   │
      │  event: SUMMARY → close              │◄═══════════════════════════════════════════════════════════════════════════════════════════│                    │
      │◄════════════════│ (SSE closes)       │                │ ack job           │                     │                 │               │                    │
      │                 │                    │◄───────────────│                   │                     │                 │               │                    │
```
Legend: `──►` request/data call · `◄──` response · `═══►` Server-Sent Events to the client.

---

## 4. Observer / EventBus model

The kernel run is the **Subject**; the worker registers **Observers** that each react to every emitted
`RunEvent`. This is the Observer pattern realized over the frozen `EventBus` port (keystone §5):

```ts
interface EventBus {
  publish(topic: string, e: unknown): Promise<void>;
  subscribe(topic: string, h: (e: unknown) => void): () => void;   // returns unsubscribe
}
```

**Topic convention**: `run:{runId}:events` (one logical channel per run; tenant-scoped by construction —
a topic is only ever subscribed after the caller proved `Run.orgId == session.orgId`).

**Implementation = Redis Streams** (`XADD` / `XREAD BLOCK`), chosen over plain Pub/Sub because:
- **Durable & replayable** — a late SSE subscriber (or a reconnect with `Last-Event-ID`) replays missed
  events; Pub/Sub would drop them.
- **Ordered** — the stream id is monotonic; it doubles as the SSE `id:` for resume.
- **Multi-consumer fan-out** — many SSE connections to the same run each `XREAD` independently.
- Stream is capped (`MAXLEN ~ N`) and TTL'd after the run terminates (events also live durably in
  `RunNode`/`Artifact`/report rows, so the stream is a transport, not the system of record).

**Registered observers** (worker side, all driven from the single `AsyncIterable<RunEvent>`):

| Observer | Reacts to | Effect | Failure policy |
|----------|-----------|--------|----------------|
| **Persist** | `NODE_STATE`,`ARTIFACT`,`SUMMARY` | `RunNode`/`Artifact`/`Run` writes (idempotent upserts) | retried; failure fails the job → BullMQ retry (§6) |
| **Broadcast** | all 4 event types | `EventBus.publish` → `XADD run:{id}:events` | best-effort; a publish error never blocks persistence |
| **Metrics** | all | fan-out latency, in-flight runners, lane utilization | best-effort |

Decoupling guarantee (**mechanism, not just intent**): the worker does **not** dispatch observers inline
from a single `for await` (which would let a slow Persist back up iteration and therefore Broadcast too).
Instead the `AsyncIterable<RunEvent>` is fanned into **one bounded async queue per observer** (a small
ring buffer, default `OBSERVER_QUEUE_MAX = 1000` events). Each observer drains its **own** queue
independently:

- **Broadcast** drains fast (one `XADD`); it is never blocked by a slow DB/blob.
- **Persist** drains at DB/blob speed; if its queue fills, backpressure applies **only to Persist** —
  it spills to a durable retry buffer (disk/queue) and never blocks Broadcast. The DB is the source of
  record, so a delayed persist is eventually-consistent, not lost.

**Ordering exception for `ARTIFACT`:** Persist must assign the `Artifact.id` (a cheap row insert) before
Broadcast emits the event so the SSE payload can carry `artifactId` (§5). Only that id-assignment is
ordered ahead of Broadcast; the **slow blob `put` is not** — it drains on Persist's own queue. So the
"slow blob never stalls the canvas" guarantee holds.

State the bound and policy explicitly: queue depth `OBSERVER_QUEUE_MAX`; on overflow, Persist → durable
retry (never drop durable state, never block Broadcast); Broadcast → best-effort (a publish error never
blocks Persist). `LOG` events are **stream-only by default** (high volume); persisted only when attached
to a node failure or captured into a `REPORT_HTML` artifact.

---

## 5. SSE — `GET /runs/{id}/events` streams to the UI

Endpoint (keystone §6: `/runs/{id}/events` — "SSE stream of RunEvent"). `Content-Type: text/event-stream`.

**Connect**
1. Resolve `orgId` from session; load `Run` filtered by `orgId`; `404` if not in tenant (no cross-tenant
   leakage). `VIEWER`+ may read.
2. Read `Last-Event-ID` request header (or `?lastEventId=`). Compute the replay start id.
3. **Snapshot + tail**: first flush a synthetic catch-up — current `Run.status`/`progress` and each
   `RunNode.state` (so a fresh canvas paints immediately), then `subscribe('run:{id}:events', …)` which
   `XREAD BLOCK`s from the replay start id forward.

**Frame format** (one per `RunEvent`):
```
id: <redis-stream-id>
event: NODE_STATE | LOG | ARTIFACT | SUMMARY
data: {"type":"NODE_STATE","nodeKey":"web__checkout","state":"RUNNING","at":"2026-06-29T12:00:01Z"}

```
- `event:` = `RunEvent.type` so the UI can `addEventListener('NODE_STATE'|…)`.
- `data:` = the `RunEvent` JSON. **`ARTIFACT` events carry `artifact.artifactId` (the persisted
  `Artifact.id`), NOT `storageKey`.** The internal kernel event (keystone §5 port form) holds the raw
  `storageKey` because the kernel just wrote the blob; the API SSE relay **maps it to `artifactId` and
  never serializes the internal storage path** to the browser (consistent with `api/README.md`:
  "`storageKey` is never serialized in any response"). The client then calls `GET /artifacts/{id}` to
  mint a short-lived **signed URL** on demand. The `artifactId` is available because the **Persist
  observer assigns `Artifact.id` before the Broadcast observer emits the event** (only the id-assignment
  is ordered — the slow blob `put` is not; see §4). This is the documented divergence in §10.6.
- `id:` = stream id → the browser's `EventSource` echoes it as `Last-Event-ID` on auto-reconnect → exactly
  once-after resume.

**Heartbeat + continuous re-authorization**: emit a comment line `: keepalive\n\n` every **15 s** to keep
proxies/load-balancers from idling the connection. **On every heartbeat tick the handler re-validates that
the session is still valid (not logged out, not password-reset-revoked, not expired) AND that the caller's
`Membership` in the run's `orgId` is still active.** Authorization is therefore *continuous*, not
connect-time-only — a stale-authorization isolation gap otherwise lets a revoked session or a
removed-member keep receiving live `RunEvent`s until the run terminates.

**Forced close on revocation**: the SSE handler subscribes to a tenant control/revocation signal
(`session:{userId}:revoked` and `org:{orgId}:membership:{userId}:revoked`, published by `POST /auth/logout`,
`POST /auth/reset-password` — which "revokes all sessions", AC-AUTH-11 — and `DELETE /orgs/{orgId}/members/{id}`).
Receiving it **immediately force-closes** every affected stream (`event: end`, then disconnect), without
waiting for the run to finish.

**Bounded stream lifetime**: a maximum stream lifetime (`SSE_MAX_STREAM_SECONDS`, default 1 h) caps any
single connection; the client transparently reconnects with `Last-Event-ID`, which re-runs the full
connect-time authorization. This bounds the blast radius of any missed revocation signal.

**Close**: when the terminal `SUMMARY` (and `sys` close sentinel) is read, or `Run.status` is terminal, the
server sends a final `event: end` and closes. On client disconnect the `subscribe` unsubscribe is called
(no leaked `XREAD` loops).

**Scale / backpressure (per-pod fan-in relay)**: SSE connections are held in `apps/api` (the
horizontally-scaled, KEDA-managed tier). To avoid **read amplification** — N viewers of one popular run
each issuing their own `XREAD BLOCK` = N× broker reads — each api pod runs **one fan-in relay per
*run*** (not per connection): a single `XREAD BLOCK` cursor on `run:{runId}:events` that **multiplexes**
to all local SSE connections subscribed to that run. Fan-out cost is therefore **O(runs) per pod, not
O(viewers)**. The first local subscriber for a run opens the relay; the last to disconnect closes it
(no leaked `XREAD` loops). A per-connection catch-up replay (from `Last-Event-ID`) is served from the
relay's recent buffer or a short replay read, then the connection joins the live multiplex.

**Viewer cap**: concurrent SSE subscribers are bounded **per run** (`SSE_MAX_VIEWERS_PER_RUN`) and **per
tenant** (`SSE_MAX_VIEWERS_PER_ORG`) to cap memory/fan-out for a single hot run or noisy tenant; excess
connections get `429`. A slow client only slows its own per-connection write buffer (bounded); if it
falls too far behind the (capped) stream it is dropped and must reconnect with `Last-Event-ID` (replays
from the oldest retained id). Mobile (`apps/mobile`/Expo) consumes the identical SSE contract.

---

## 6. Concurrency, parallel lanes, idempotency, cancellation

### 6.1 Two independent concurrency controls
1. **Global runner concurrency** ("max concurrent runners") — how many *runs* execute across the cluster.
   Enforced by BullMQ `Worker { concurrency }` per pod × replica count, with **KEDA** scaling the worker
   deployment off the `runs` queue depth (scale-to-zero when idle — Azure cost driver). Budget §8.
2. **Per-run parallel lanes** ("waves = parallel lanes") — how many STAGE nodes within one run's wave run
   at once. Enforced inside `TestKernel.run` by a semaphore sized to **laneLimit**, derived from the
   tenant's plan tier:

| `Subscription.plan` | laneLimit | source |
|---------------------|-----------|--------|
| `TEAM` | **3** | keystone §9 / prototype §5 |
| `PRO` | **10** | keystone §9 / prototype §5 |
| `ENTERPRISE` | **unlimited** (hard cap `ENT_LANE_HARD_CAP=50` for safety) | keystone §9 |

A wave with more eligible nodes than `laneLimit` runs in sub-batches of `laneLimit`. laneLimit is passed to
the adapter at construction (`createTestKernel({ maxLanes })`), keeping the frozen `run(plan)` signature
intact.

### 6.2 Idempotency (at-least-once everywhere)
- **Enqueue idempotency**: `Idempotency-Key` header → `(orgId, key)`→`runId` map (Redis, 24 h TTL). Replay
  returns the same `Run`.
- **Job dedup**: BullMQ `jobId = runId` — re-enqueuing a run is a no-op while the job exists.
- **Event/persist idempotency**: every persist is an **upsert keyed `(runId, key)`** (RunNode) or
  `(runId, storageKey)` (Artifact). `RunNode.state` transitions are **monotonic** along
  `IDLE → QUEUED → RUNNING → DONE_PASS|DONE_FAIL`; a redelivered or out-of-order older state is ignored
  (never moves a node backward). `SUMMARY` write is last-writer-idempotent.
- **Plan determinism**: `plan(input)` is pure → recomputing on retry yields identical node keys, so
  resume targets the same rows.
- **Worker crash / retry (resume)**: BullMQ stalled-job recovery re-delivers the job. The handler sees
  `Run.status=RUNNING`, re-`plan()`s, reads existing `RunNode` rows, and **skips nodes already in a
  terminal state** (`DONE_PASS|DONE_FAIL`); any node left `RUNNING` (orphaned by the crash) is reset to
  `QUEUED` and re-executed. The set of completed node keys is provided to the adapter as resume config
  (`createTestKernel({ resumeCompleted })`) — again, no change to the frozen method signature.

### 6.3 Cancellation — `POST /runs/{id}/cancel`
1. AuthZ (`OWNER|ADMIN|MEMBER`, tenant-scoped). Set an intent flag and publish to a control channel
   `run:{runId}:control` (`{action:'CANCEL', by:userId}`).
2. The worker (subscribed to the control channel) calls `TestKernel.cancel(runId)`:
   - aborts the in-flight `AsyncIterable` via an `AbortSignal`;
   - issues gRPC **cancellation** to chaos-proxy for in-flight intents (stop the SUT work);
   - does **not** start any further waves.
3. **State settlement** (keystone has no per-node `CANCELED` state — see Deviations): non-terminal nodes
   are **left at their last `RunNodeState`** (`IDLE`/`QUEUED`/`RUNNING`); they are not faked into a
   terminal state. `Run.status=CANCELED`, `finishedAt=now`, `progress` frozen, `SUMMARY` computed from
   whatever completed. A final `LOG level='sys'` ("Run canceled by {user}") closes the stream.
4. Idempotent: a second cancel on an already-terminal run is a `409`/no-op. `AuditLog action=RUN_CANCELED`.

---

## 7. Performance budgets (first-class — enforced in CI / load tests)

| Budget | Target | Notes / how measured |
|--------|--------|----------------------|
| **Enqueue latency** `POST /runs` → `202` | p95 **< 150 ms**, p99 < 300 ms | one `Run` insert + one BullMQ add; no kernel work on the request path |
| **Plan build** `plan()` | **< 50 ms** for ≤ 50 stages (pure CPU) | unit-benchmarked; deterministic |
| **Time-to-first-event** (enqueue → first `NODE_STATE` on SSE) | p95 **< 1.5 s** (warm worker) | dominated by job pickup + `__dispatch`; excludes cold KEDA scale-up |
| **Event fan-out latency** (kernel emit → byte on SSE client) | p95 **< 250 ms**, p99 < 500 ms | emit → `XADD` → `XREAD` → flush |
| **SSE connect** (request → first byte/snapshot) | p95 **< 200 ms** | snapshot from DB + stream tail |
| **Max concurrent runs / worker pod** | `RUNNER_CONCURRENCY = 5` | BullMQ `Worker.concurrency`; CPU/mem bound per pod |
| **Max concurrent runs / cluster (QA)** | **50** (KEDA `maxReplicas × concurrency`) | scale-to-zero when idle; raise for prod tier |
| **Per-run parallel lanes** | `TEAM 3 / PRO 10 / ENT ∞ (cap 50)` | §6.1 semaphore |
| **Artifact signed-URL TTL** | **900 s** default (`ARTIFACT_URL_TTL`) | short-lived; minted per `GET /artifacts/{id}` |
| **LOG event throughput** | stream-only; persisted lines batched (flush ≤ 250 ms or ≤ 50 lines) | avoids DB write storms on chatty runs |
| **Redis Stream retention** | `MAXLEN ≈ 5 000` events/run; TTL 1 h post-terminal | transport only; DB is source of record |
| **Heartbeat** | every **15 s** | keeps SSE alive through proxies |

KEDA scale-to-zero means **idle cost ≈ 0** (decision #11); the first run after idle pays a cold-start that
is explicitly excluded from the steady-state time-to-first-event budget.

---

## 8. Security & tenant isolation (cross-cutting, applies to every step)

- **Per-`orgId` isolation on every query** — enqueue, status, SSE, cancel, report, artifact: each resolves
  `orgId` from the session and filters by it. A run/artifact from another org is `404`, never leaked.
- **Event topics & streams are tenant-scoped** — `run:{runId}:events` is only subscribed after the caller
  proved `Run.orgId == session.orgId`; the job payload carries `orgId` so the worker writes the correct
  tenant rows.
- **Artifacts are private** — stored under tenant-scoped `storageKey`; never public. Access only via
  **signed expiring URLs** (`ArtifactStorage.signedUrl(key, 900)`), minted per request through
  `GET /artifacts/{id}` after an `orgId` check.
- **Secrets** — chaos-proxy endpoint / blob / Redis creds are **Key Vault references** (`Integration.secretRef`
  pattern), never raw tokens in code, jobs, logs, or events.
- **RBAC** — `VIEWER` read-only (status/SSE/report); `MEMBER+` may enqueue/cancel.
- **Transport** — mTLS platform↔chaos-proxy (`CONTRACT.md`); HTTPS for API/SSE.
- **Audit** — `RUN_ENQUEUED` / `RUN_CANCELED` / `RUN_COMPLETED` / `RUN_FAILED` written to `AuditLog`.
- **Quota = cost cap** — per-tenant `runMinutesQuota` gate at enqueue + metered at finalize prevents a
  single tenant from exhausting shared runners (multi-tenant cost driver). Target **OWASP ASVS L2**.

---

## 9. Status & state reference (keystone enums — used verbatim)

```
RunStatus     QUEUED → RUNNING → DONE | FAILED | CANCELED
RunMode       BDD | STEPS
RunTrigger    MANUAL | CI | SCHEDULE
RunNodeKind   DISPATCH | STAGE | CONSOLIDATE      (__dispatch / stages / __consolidate)
RunNodeState  IDLE → QUEUED → RUNNING → DONE_PASS | DONE_FAIL   (monotonic)
ArtifactType  VIDEO | SCREENSHOT | HAR | LOG | REPORT_HTML
CaptureMode   OFF | ON_FAIL | ALWAYS | ON_DEMAND   (governs whether a STAGE emits ARTIFACTs)
Plan          TEAM | PRO | ENTERPRISE              (→ laneLimit 3 / 10 / ∞)
```

`RunEvent` union (keystone §5) carried verbatim end-to-end: `NODE_STATE | LOG | ARTIFACT | SUMMARY`.

---

## 10. Deviations / clarifications (flagged per HARD RULES)

1. **`PlanNode` shape** — keystone §5 references `PlanNode[]` inside `RunPlan` but does not spell out its
   fields. This doc defines `PlanNode` (§2.3) as the planning-relevant subset of the `RunNode` entity
   (`key, kind, slot?, tool?, feature?, sliceId?, level, deps`). No new enums/entities introduced; should
   be promoted into the keystone §5 verbatim.
2. **No per-node `CANCELED` state** — `RunNodeState` (frozen) has no `CANCELED`. Cancellation is therefore
   modeled at the **`Run`** level (`RunStatus=CANCELED`) + a terminal `sys` `LOG`; non-terminal nodes are
   left at their last state rather than invented into a terminal one (§6.3).
3. **`DONE` vs `FAILED` semantics** — keystone freezes the values but not the rule. Adopted: `DONE` = DAG
   reached `__consolidate` (test `failed>0` lives in counts, not in `Run.status`); `FAILED` = execution
   fault (node `ERROR` / chaos-proxy unreachable / plan error). Documented for downstream alignment (§2.8).
4. **laneLimit & resume as adapter construction config** — to honor the frozen `TestKernel.run(plan)`
   signature, per-run lane width and resume-completed sets are passed via the adapter **factory**
   (`createTestKernel({ chaosProxyEndpoint, maxLanes, resumeCompleted })`), not added to `RunPlan`/method
   args. No port method signature changed.
5. **EventBus backbone = Redis Streams (local) — and the cloud adapter MUST honor the same fan-out
   contract.** The frozen `EventBus` port is implemented over Redis Streams locally (not plain Pub/Sub)
   to get durability, ordering and `Last-Event-ID` replay for SSE. **The SSE layer depends on two
   guarantees beyond bare `publish/subscribe`, which are hereby pinned as a port-level requirement so no
   adapter can silently drop them:**
   1. **Broadcast (multi-consumer) fan-out** — every SSE connection/replica that subscribes to a run
      receives **every** event, independently. A **competing-consumer** transport (where each message is
      delivered to exactly one consumer) does **NOT** satisfy this.
   2. **Resumable replay** — `Last-Event-ID` resumes from a durable position.

   **Cloud-transport caveat (reconciles with `specs/infra/azure-environments.md` §6).** The Azure QA env
   maps `EventBus` to **one Service Bus topic `run-events` + one subscription `api-sse`**. Service Bus
   subscriptions are **competing-consumer**, so with `api` scaled 0→3 an event is delivered to exactly
   one api replica — a viewer whose SSE connection landed on a different replica would never see it, and
   `Last-Event-ID` replay is unimplementable (Service Bus is not a replayable log). The Service Bus
   adapter therefore MUST satisfy the contract by one of:
   - a **per-replica (or per-connection) subscription** created on SSE connect and deleted on close, so
     every replica receives a full copy of the topic; **plus** a **DB-backed snapshot for replay**
     (re-read `RunNode` states + a bounded per-run `RunEvent` journal) so `Last-Event-ID` resumes from
     durable rows rather than the broker; **or**
   - a **replayable log** transport (Azure Event Hubs, or Redis Streams via Azure Cache) standing in for
     the topic.

   The "drop to Basic / Postgres `LISTEN/NOTIFY`" fallback noted in infra §6 has neither durability nor
   replay and does **not** satisfy this contract on its own (it needs the same DB-snapshot replay).
6. **`RunEvent.ARTIFACT` SSE wire shape = `artifactId`, not `storageKey`** — the keystone §5 port event
   is frozen and carries the kernel-internal `storageKey`. The **HTTP SSE serialization** (OpenAPI
   `RunEventArtifact`) and the API relay (§5) emit the persisted **`Artifact.id` (`artifactId`)** instead
   — the internal storage path is never sent to the browser (security finding). This is an intentional
   divergence of the *wire DTO + relay* from the *frozen port event*; the keystone is **not** changed
   (the orchestrator keeps it authoritative). The relay maps `storageKey → artifactId` using the
   `Artifact` row the Persist observer wrote (§4 ordering exception).
```
