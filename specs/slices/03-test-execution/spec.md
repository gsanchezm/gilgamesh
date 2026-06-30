# Slice 3 — Test Execution + Results (SDD Spec)

> Spec-Driven-Design spec for the third vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-06-30. Status: DRAFT — building SDD→BDD→TDD on branch `slice-3-test-execution`.

---

## 0. Keystone position — read first (§7 deviation, owner decision S3)

Keystone **§7** marks the **Orchestration / Reports-from-real-runs slices `BLOCKED-UNTIL-DELIVERED`**: real
runs require the owner's `chaos-proxy`/TOM kernel + intents catalog + `AgentPlugin`s (decision #5), still in
progress. The full keystone execution model is **asynchronous**: `POST /projects/{id}/runs` enqueues → BullMQ
worker (`apps/workers`) invokes `@gilgamesh/kernel` → `TestKernel.run(plan)` streams `RunEvent`s → `RunNode`
(DAG) + `Artifact` rows → `/runs/{id}/events` SSE to the client.

§7 also states: *"everything else proceeds NOW behind the `TestKernel` port without these."* **Owner decision
S3** takes that path: build the **execution shell behind a deterministic `TestKernel` stub** (exactly the
Brain-stub pattern of slice 2), as a **synchronous núcleo**. The real `chaos-proxy` adapter + SSE + DAG +
workers land in the Orchestration slice when the kernel is delivered. This slice has **zero** dependency on
`chaos-proxy`, plugins, a System-Under-Test, a queue, or the network.

---

## 1. Feature intent

Close the QA core loop: a workspace that has **authored** tests (slice 2) can now **run** them and **see
results** in-app. Within a `Project`, a member triggers a `Run` of a `Feature` (its `Scenario`s) or a
`TestCase`; the `TestKernel` (stub) executes it deterministically; the `Run` is persisted with an aggregate
`RunStatus` + counts (`passed/failed/skipped/total`, `ratePct`, `durationMs`) and per-scenario results; the
team reads run history and the latest status reflected back onto `Scenario.lastStatus` / `TestCase.status`.

---

## 2. Scope

### In scope
- **Trigger a run** — `POST /projects/{id}/runs` with a target (`{kind: FEATURE|TESTCASE, id}`): create a
  `Run`, execute it synchronously through the `TestKernel` port, persist the terminal result. RBAC: authors only.
- **`TestKernel` port + deterministic stub** — the keystone `TestKernel` seam; the slice-3 adapter is an
  **offline, reproducible stub** that derives per-scenario pass/fail/skip from the scenario name/tag (e.g. a
  name/tag containing `fail`→FAILED, `skip`/`wip`→SKIPPED, else PASSED) and emits `RunEvent`s the use case
  consumes to completion. No chaos-proxy, SUT, or network.
- **Results model** — `Run` (keystone entity, slice-3 field subset) + per-scenario `RunNode`-lite results
  (name, status, log lines). Aggregate `RunStatus` (any fail→`FAILED`, else `DONE`) + counts + `durationMs`.
- **Read runs** — `GET /projects/{id}/runs` (newest-first) and `GET /runs/{id}` (run + its results).
- **Status reflection** — the latest run updates `Scenario.lastStatus` (per scenario) and `TestCase.status`
  (PASS/FAIL/…) so the Test Lab shows the last outcome.
- Cross-cutting: per-`orgId` tenant isolation, RBAC, audit (`run.created`), validation, RFC9457 errors, CSRF
  on the trigger mutation, the same two persistence wirings (in-memory + Prisma) as slices 1–2.

### Out of scope (explicitly deferred — Orchestration / Reports slices)
- **Real execution** — `chaos-proxy` gRPC adapter, `AgentPlugin`s, `ExecuteIntent`/`IntentResult`, locator
  resolution, a System-Under-Test. The `TestKernel` is wired to a **stub** only (decision S3).
- **Async queue + streaming** — BullMQ `apps/workers`, `/runs/{id}/events` (SSE), live `progress`. Slice 3
  runs **synchronously** and returns the completed `Run`.
- **DAG orchestration** — `RunNode` graph/canvas, `selectedStages`, `mode:RunMode`, `/runs/{id}/nodes/{id}`.
  Slice 3 stores a flat per-scenario result list, not a DAG.
- **Artifacts & reports** — `Artifact` rows, signed URLs, `/runs/{id}/report`, `commitSha`.
- **Cancel** — `/runs/{id}/cancel` + the `CANCELED`/`QUEUED`/`RUNNING` transient states beyond what a sync run
  needs (a sync run goes straight to `DONE`/`FAILED`).
- **Scheduling / CI triggers** — `RunTrigger` beyond `MANUAL`.

---

## 3. Actors / personas

| Actor | Slice-3 capabilities |
|-------|----------------------|
| **Owner / Admin** (`OWNER`/`ADMIN`) | Trigger runs; read runs + results. |
| **Member** (`MEMBER`) | Trigger runs; read runs + results. |
| **Viewer** (`VIEWER`) | Read runs + results; triggering a run → `403`. |
| **Non-member** | Any run endpoint for the project → `404` (existence not leaked). |

---

## 4. Domain model (keystone names verbatim; slice-3 subset)

- **`RunStatus`** = `QUEUED | RUNNING | DONE | FAILED | CANCELED` (keystone). Slice 3 uses `RUNNING` (transient,
  in-memory during the sync execute) and terminal `DONE`/`FAILED`; `QUEUED`/`CANCELED` are modeled but unused.
- **`Run`** (keystone entity; slice-3 persisted fields): `id, orgId, projectId, status:RunStatus,
  trigger:RunTrigger(=MANUAL), runLabel, passed?, failed?, skipped?, total?, ratePct?, durationMs?,
  createdById, startedAt?, finishedAt?, createdAt`. (Deferred keystone fields: `mode, selectedStages,
  progress, commitSha` — Orchestration slice.)
- **`RunResult`** (slice-3, `RunNode`-lite) — `id, runId, kind:(SCENARIO|TESTCASE), refId, name, status:
  ResultStatus(PASS|FAIL|SKIP), log(string[])`. (The full keystone `RunNode` DAG node is the Orchestration slice.)
- **Target** — a run references exactly one authored entity: a `Feature` (executes its `Scenario`s) or a
  `TestCase`. Validated to belong to the project (cross-tenant/cross-project → `NOT_FOUND`).

### `TestKernel` port (keystone seam, `@gilgamesh/application` ports)
```
interface TestKernel {
  run(plan: RunPlan): { runId: string; events: AsyncIterable<RunEvent> };
}
type RunPlan = { runId: string; target: RunTargetPlan };       // slice-3 plan (no DAG/stages)
type RunEvent =
  | { type: 'LOG'; level: 'sys'|'run'|'pass'|'fail'|'log'; text: string; at: string }
  | { type: 'RESULT'; refId: string; name: string; status: 'PASS'|'FAIL'|'SKIP' }
  | { type: 'DONE'; passed: number; failed: number; skipped: number; total: number; durationMs: number };
```
The use case calls `run(plan)` and consumes `events` to completion, folding them into the `Run` + `RunResult`s.
The **`DeterministicKernel`** stub is offline and pure (no `Date.now`/`Math.random`; timings are fixed) so runs
are reproducible and testable — mirroring `DeterministicBrain`.

---

## 5. API (keystone §6 paths)

| Method · Path | Use case | Auth |
|---|---|---|
| `POST /projects/{id}/runs` | `TriggerRun` (create + execute via stub kernel, return completed `Run`) | author, CSRF |
| `GET /projects/{id}/runs` | `ListRuns` (newest-first) | member |
| `GET /runs/{id}` | `GetRun` (run + its `RunResult`s) | member (tenant-scoped) |

Errors via `DomainExceptionFilter` → RFC9457. Trigger body: `{ targetKind: 'FEATURE'|'TESTCASE', targetId,
runLabel? }`. Deferred keystone paths: `/runs/{id}/events`, `/runs/{id}/cancel`, `/runs/{id}/report`,
`/runs/{id}/nodes/{nodeId}`, `/artifacts/{id}`.

---

## 6. Acceptance criteria

- **AC-RUN-01** — A member triggers a run for a `Feature` (`POST /projects/{id}/runs` `{FEATURE,id}`) → a
  `Run` is created and executed via the `TestKernel` stub to a terminal `RunStatus`, with one `RunResult` per
  scenario and `passed/failed/skipped/total` counts.
- **AC-RUN-02** — A member triggers a run for a `TestCase` → a `Run` with a single `RunResult`.
- **AC-RUN-03** — The `TestKernel` is a port; slice 3 wires a **deterministic stub** (offline, reproducible).
  No chaos-proxy, SUT, queue, or network is touched.
- **AC-RUN-04** — Aggregate status: any scenario `FAIL` → run `FAILED`; otherwise `DONE`. `ratePct` =
  passed/total·100; counts and `durationMs` are populated.
- **AC-RUN-05** — `GET /runs/{id}` returns the run and its per-scenario `RunResult`s (name, status, log).
- **AC-RUN-06** — `GET /projects/{id}/runs` lists runs newest-first.
- **AC-RUN-07** — Triggering audits `run.created`; the `Run` + `RunResult`s persist in both wirings.
- **AC-RUN-08** — Re-running a target creates a **new** `Run` (history preserved); the latest run updates
  `Scenario.lastStatus` / `TestCase.status`.
- **AC-RUN-09** — Determinism: the same target content yields the same run result (reproducible stub).
- **AC-RUN-10** — Tenant isolation: a non-member triggering/reading runs for a foreign project → `404`.
- **AC-RUN-11** — RBAC: a `VIEWER` reads runs but triggering → `403`.
- **AC-RUN-12** — Triggering with a `targetId` not in the project (missing/foreign) → `404`/`VALIDATION`.

---

## 7. Non-functional

- **Tenant isolation** — every run query is `orgId`-scoped via `requireProjectAccess`; non-members get `404`.
- **Clean Architecture** — `TriggerRun`/`ListRuns`/`GetRun` depend only on ports (`TestKernel`, repos, `Clock`,
  `IdGenerator`, `UnitOfWork`); the kernel stub + Prisma adapters are wired in `apps/api`. Domain stays
  framework-free (guarded by the architecture fitness test).
- **Atomicity** — creating the `Run` + writing its `RunResult`s + reflecting `lastStatus`/`status` commit in
  one `UnitOfWork.transaction` (mirrors slice-2 feature writes).
- **Reproducibility** — the stub kernel is pure/offline; identical inputs → identical runs (no clock/RNG leak).
- **Security** — CSRF double-submit on `POST /runs`; OWASP ASVS L2; no secrets (no real kernel yet).
- **Perf** — a sync stub run is in-memory and bounded by scenario count; budget < 50ms for typical features.
