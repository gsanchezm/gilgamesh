# `@gilgamesh/kernel` — TestKernel Contract

> The **capability seam** of Gilgamesh. This package is the *only* place the platform knows how tests
> actually execute. Everything inward of it (domain, application use-cases, API, UI) depends on the
> **`TestKernel` port** (keystone §5) and never on the owner's chaos-proxy directly (Law of Demeter).
> The default — and only product-wired — adapter speaks **gRPC to the owner's `chaos-proxy`** (TOM kernel,
> decisions #4/#5). Built **open for extension, closed for modification**: the owner will add capability
> repos over time (decision #5); each registers behind this stable port without changing callers.
> All names/enums/signatures are **verbatim** from `specs/_keystone/foundation-vocabulary.md`.
> Companion: `specs/runtime/run-lifecycle.md` (how a Run flows through this port). v0.1 — 2026-06-29.

---

## 1. Position in the architecture

```
        depends on ──►                         (deps point inward only)
@gilgamesh/domain ◄── @gilgamesh/application ◄── @gilgamesh/kernel ──► chaos-proxy (gRPC :50051)  [EXTERNAL]
                          (PORT interfaces)        (port + adapter)        ├─ plugin: playwright  (:5005x)
                                                    + Registry             ├─ plugin: appium / mobilewright
apps/workers ── invokes ──► @gilgamesh/kernel                             ├─ plugin: api
apps/api     ── never reaches into kernel internals (only the port)       ├─ plugin: gatling (perf)
                                                                          └─ plugin: pixelmatch (visual)
```

- `@gilgamesh/kernel` exports: the `TestKernel` port, the `AgentPlugin` + `AgentPluginRegistry` types, a
  `createTestKernel(config)` **factory** that returns the gRPC adapter, and the gRPC client wiring.
- The platform composition root (in `apps/workers`) calls `createTestKernel(...)`; nothing else imports
  the adapter or the generated gRPC stubs.
- **Stable-port rule**: new owner capability repos = new plugin servers behind chaos-proxy and/or new
  `(slot, tool)` registrations. They are **additive**; no method on `TestKernel`/`AgentPlugin` changes.

---

## 2. The `TestKernel` port (FROZEN — keystone §5, verbatim)

```ts
type ExecuteIntent = { intentId: string; payload: unknown; locatorKey?: string; platform: string; viewport?: {w:number;h:number} };
type IntentResult  = { status: 'PASS'|'FAIL'|'ERROR'; payload?: unknown; metrics?: Record<string,number> };

interface AgentPlugin {
  slot: AgentSlot;             // lead | arch | manual | web | api | android | ios | perf | visual | sec | a11y
  tool: string;                // the concrete tool under the hood (Playwright, Appium, k6, …)
  supportedIntents: string[];  // INTENT.* ids this plugin can serve
  execute(i: ExecuteIntent): Promise<IntentResult>;
}
interface AgentPluginRegistry {
  register(p: AgentPlugin): void;
  resolve(slot: AgentSlot, tool: string): AgentPlugin | null;
}

type RunPlanInput = { runId: string; projectId: string; mode: RunMode; stages: StageSpec[] };
type StageSpec    = { key: string; slot: AgentSlot; tool: string; feature?: string; deps: string[] };
type RunPlan      = { runId: string; nodes: PlanNode[]; waves: string[][] };   // nodes incl. __dispatch/__consolidate
type RunEvent =
  | { type:'NODE_STATE'; nodeKey:string; state:RunNodeState; at:string }
  | { type:'LOG'; nodeKey?:string; level:'sys'|'run'|'pass'|'fail'|'log'; text:string; at:string }
  | { type:'ARTIFACT'; nodeKey:string; artifact:{ type:ArtifactType; storageKey:string; contentType:string; sizeBytes:number } }
  | { type:'SUMMARY'; passed:number; failed:number; skipped:number; total:number; ratePct:number; durationMs:number };

interface TestKernel {
  plan(input: RunPlanInput): RunPlan;                                      // dispatch → stages by deps → consolidate
  run(plan: RunPlan): { runId: string; events: AsyncIterable<RunEvent> };  // executes via chaos-proxy
  cancel(runId: string): Promise<void>;
}
```

**`PlanNode`** (resolved here — keystone references it in `RunPlan` but leaves the shape implicit; mirrors
the planning subset of the `RunNode` entity; flagged in Deviations):
```ts
type PlanNode = {
  key: string; kind: RunNodeKind;     // DISPATCH | STAGE | CONSOLIDATE
  slot?: AgentSlot; tool?: string;
  feature?: string; sliceId?: string;
  level: number; deps: string[];
};
```

### 2.1 `plan()` — pure DAG builder (no I/O, deterministic)
`__dispatch` (`kind=DISPATCH`, `slot=lead`, level 0) → STAGE nodes (`level = 1 + max(dep levels)`) →
`__consolidate` (`kind=CONSOLIDATE`, `slot=lead`, final level, `deps` = all leaf stages). `waves` = node
keys grouped by `level` ascending; each wave is a set of nodes eligible to run in parallel ("lanes").
Because it is pure, `plan()` is fully unit-testable **today, without the chaos-proxy**, and is safe to
recompute on worker retry (resume). Full algorithm: `specs/runtime/run-lifecycle.md` §2.3.

### 2.2 `run()` — execute the DAG, stream `RunEvent`s
Drives waves in level order, capping in-flight STAGE nodes at the per-run **laneLimit** (TEAM 3 / PRO 10 /
ENT ∞ — supplied via the factory, not the frozen signature). For each STAGE node it resolves the plugin
via the registry, builds an `ExecuteIntent`, sends it to chaos-proxy, maps `IntentResult.status`
(`PASS→DONE_PASS`, `FAIL→DONE_FAIL`, `ERROR→DONE_FAIL`+`LOG`), and surfaces plugin telemetry/artifacts as
`LOG`/`ARTIFACT` events. After the last wave, emits one `SUMMARY`. `DISPATCH`/`CONSOLIDATE` are kernel-
internal (no SUT call).

### 2.3 `cancel()` — abort in flight
Aborts the active `AsyncIterable` (AbortSignal), issues gRPC cancellation for in-flight intents to
chaos-proxy, and starts no further waves. No per-node `CANCELED` state exists (keystone-frozen
`RunNodeState`), so cancellation settles at the `Run` level — see run-lifecycle §6.3.

---

## 3. `AgentPlugin` / `AgentPluginRegistry` — the Strategy/Factory seam

"Plugin identity = the tool under the hood" (prototype §12). The 11 agents (keystone §3) bind to plugins by
`(slot, tool)`. `ToolBinding.tool` (per-Project, the awake tool) selects which plugin a stage resolves to:

| `AgentSlot` | deity | `tool` options (keystone §3) | chaos-proxy plugin server | platform |
|-------------|-------|------------------------------|---------------------------|----------|
| `web` | Quetzalcóatl | **Playwright**, Cypress | `playwright` (`:5005x`) | web |
| `api` | Iris | **Postman**, REST Assured, Karate | `api` | api |
| `android` | Freya | **Appium**, Mobilewright | `appium` / `mobilewright` | android |
| `ios` | Isis | **Appium**, Mobilewright | `appium` / `mobilewright` | ios |
| `perf` | Thor | **k6**, Gatling, JMeter | `gatling` (perf engine) | api/load |
| `visual` | Xochiquetzal | **Pixelmatch**, Applitools | `pixelmatch` | web |
| `sec` | Odin | **OWASP ZAP**, Burp Suite | (security plugin — owner) | web/api |
| `a11y` | Ra | **axe-core**, Pa11y | (a11y plugin — owner) | web |
| `lead` | Zeus | Helix Core | kernel-internal (dispatch/consolidate) | — |
| `arch` | Athena | Strategy | planning-only (no SUT execution) | — |
| `manual` | Anubis | Suites · Steps | manual/no automated execution | — |

- **Registry**: `register(plugin)` keyed by `(slot, tool)`; `resolve(slot, tool)` returns the plugin or
  `null` (→ a clear `LOG level='fail'` + node `DONE_FAIL`, never a silent skip). Two plugins MAY serve one
  test type (e.g. `appium` and `mobilewright` both for `android`/`ios`).
- **Open/closed**: a new owner capability = `register()` a new `AgentPlugin` whose `execute()` forwards to
  a new chaos-proxy plugin server. No caller changes.
- `supportedIntents` lets the adapter validate, before dispatch, that a stage's required `INTENT.*` ids are
  served by the resolved plugin (fail fast with a precise message).

---

## 4. gRPC adapter → chaos-proxy (the real, default-wired execution path)

The adapter is the concrete `TestKernel` returned by `createTestKernel(config)`. It is the **single** owner
of the gRPC wire to chaos-proxy.

### 4.1 Factory & config
```ts
createTestKernel(config: {
  chaosProxyEndpoint: string;     // host:50051 — value via Key Vault ref / env, NEVER a literal secret
  maxLanes: number;               // per-run lane width (TEAM 3 / PRO 10 / ENT cap 50)
  resumeCompleted?: string[];     // node keys already terminal (worker-retry resume; §run-lifecycle 6.2)
  deadlineMs?: number;            // per-intent gRPC deadline (default 30_000)
  tls: { caRef: string; clientCertRef: string; clientKeyRef: string };  // mTLS material as vault refs
}): TestKernel
```
`maxLanes` and `resumeCompleted` are **construction config**, deliberately *not* added to the frozen
`run(plan)` signature — the port stays byte-for-byte the keystone port.

### 4.2 Wire contract (chaos-proxy, prototype §12 / keystone §7)
chaos-proxy `:50051` exposes the TOM kernel: it resolves logical `locatorKey` → platform selector, retries
transient faults (StaleElement/Timeout, exponential backoff), emits telemetry, and routes typed **intents**
to plugin servers (`:5005x`) by `DRIVER`. The expected service surface (proto names owned by chaos-proxy;
we generate stubs from the owner's `.proto`):

```proto
service ChaosProxy {
  // unary: one intent → one result (mirrors src/kernel/client.ts sendIntent(INTENT.ID, payload))
  rpc Execute (ExecuteIntentMsg) returns (IntentResultMsg);
  // server-stream: live telemetry + artifact notifications for a node/intent
  rpc ExecuteStream (ExecuteIntentMsg) returns (stream NodeTelemetryMsg);
  // intents catalog — single source of truth (src/kernel/intents.ts), fetched at startup to validate
  rpc ListIntents (Empty) returns (IntentCatalogMsg);
  // cooperative cancellation of in-flight work for a run/intent
  rpc Cancel (CancelMsg) returns (Empty);
}
// ExecuteIntentMsg  ≡ ExecuteIntent { intentId, payload(bytes/Struct), locatorKey, platform, viewport }
// IntentResultMsg   ≡ IntentResult  { status: PASS|FAIL|ERROR, payload, metrics: map<string,double> }
// NodeTelemetryMsg  = { kind: LOG|ARTIFACT|METRIC, ... } → mapped to RunEvent.LOG / RunEvent.ARTIFACT
```

### 4.3 Mapping `RunEvent` ← chaos-proxy
- Adapter emits `NODE_STATE QUEUED→RUNNING` around each `Execute`/`ExecuteStream`.
- `NodeTelemetryMsg(LOG)` → `RunEvent.LOG { nodeKey, level, text, at }`.
- `NodeTelemetryMsg(ARTIFACT)` → `RunEvent.ARTIFACT { nodeKey, artifact:{ type:ArtifactType, storageKey,
  contentType, sizeBytes } }`. The plugin writes the blob (video/screenshot/HAR) to tenant-scoped storage
  (pre-signed PUT, or streamed through the worker); the adapter forwards the resulting `storageKey`.
  `CaptureMode` (OFF/ON_FAIL/ALWAYS/ON_DEMAND) decides whether a stage emits artifacts at all.
- `IntentResultMsg.status` → `NODE_STATE DONE_PASS|DONE_FAIL`; `metrics` feed the perf gauges and `SUMMARY`.

### 4.4 Resilience & security
- **Deadlines** on every RPC; **connection retry with backoff** to chaos-proxy; **circuit breaker** so a
  proxy outage fails fast (node `ERROR`→`DONE_FAIL`, run `FAILED`) instead of hanging the worker.
- chaos-proxy already handles in-SUT transient retries; the adapter does **not** double-retry a definitive
  `FAIL` (only infra/connection faults).
- **mTLS** platform↔chaos-proxy; endpoint + cert material are **Key Vault references**, never literals in
  code/logs/events.
- **Tenant context**: `orgId` and `runId` propagate as gRPC metadata so artifact keys are tenant-scoped and
  telemetry is attributable; never trust a tenant id echoed back — always re-check against the worker's job
  `orgId`.

### 4.5 Contract tests (consumer-driven)
A recorded/double-backed contract suite verifies the adapter against the proto: intent round-trip,
PASS/FAIL/ERROR mapping, telemetry→`RunEvent` mapping, deadline/cancel behavior, locatorKey passthrough.
These run in CI using the **in-repo test double** (§7), so the adapter is verified without a live proxy.

---

## 5. External-dependency contract — what the owner must deliver (keystone §7)

Real runs need capabilities the owner is still building (decision #5). The platform is designed so that
**only real-run orchestration** depends on them; everything else ships now behind this port.

### 5.1 Required deliverables from the owner
| # | Deliverable | What it must provide | Consumed by |
|---|-------------|----------------------|-------------|
| D1 | **Runnable `chaos-proxy` image** (`:50051`) | gRPC server implementing §4.2; locator resolution; transient retry; telemetry/artifact streaming | gRPC adapter §4 |
| D2 | **The `.proto` + intents catalog** | `ExecuteIntent`/`IntentResult` messages + `INTENT.*` ids (`src/kernel/intents.ts` — single source of truth) + locatorKey scheme | stub generation, `supportedIntents` validation |
| D3 | **≥ 1 real plugin server: `playwright`** (`:5005x`) | executes web intents against a SUT, emits video/screenshot/HAR artifacts | `web`/`visual` stages |
| D4 | **Sample SUT: OmniPizza** (`gsanchezm/omnipizza-web`, web) | a deployable target the runners hit (docker-compose service) | end-to-end real run |
| D5 | **Artifact emission contract** | `{ type:ArtifactType, contentType, sizeBytes }` + where bytes land (pre-signed PUT vs stream) so the kernel surfaces `RunEvent.ARTIFACT` | artifact persistence |
| D6 | **mTLS material / endpoint** | how the platform authenticates to chaos-proxy (cert/CA) — delivered as Key Vault refs | adapter security §4.4 |
| D7 | **Proto/version compatibility note** | semver of the proto so we pin a known-good version; additive-only changes | dependency pinning |

> Later plugins (`appium`/`mobilewright`, `api`, `gatling`/k6, `pixelmatch`, security, a11y) extend the same
> contract additively (open/closed). Only **D1–D5** are needed to unblock the first real run.

### 5.2 BLOCKED-UNTIL-DELIVERED checklist
**Blocked** until D1–D5 land and pass the §4.5 contract tests against the *real* proxy:

- [ ] **Orchestration slice — real execution** (`TestKernel.run` against live chaos-proxy + SUT).
- [ ] **Reports from real runs** (real `Artifact` rows, signed media URLs, perf gauges from real `metrics`).
- [ ] Real `RunEvent.ARTIFACT` media in the Reports media viewer ("Captured by Helix runner").
- [ ] Real perf drill-down (throughput/p95/error%) — needs `gatling`/k6 plugin (a later D).
- [ ] docker-compose "real QA loop" (chaos-proxy + playwright + OmniPizza) per decision #11.

**Proceeds NOW, behind the port (NOT blocked)** — no chaos-proxy required:

- [x] `TestKernel` **port**, `AgentPlugin`/`AgentPluginRegistry`, `createTestKernel` **factory + gRPC
      adapter skeleton** (stubs generated from D2 when it lands; interface stable now).
- [x] `plan()` **DAG builder** — pure, deterministic, fully unit-tested (dispatch→stages→consolidate, waves).
- [x] **Run lifecycle plumbing** — enqueue (BullMQ), worker, `EventBus` (Redis Streams), SSE
      `/runs/{id}/events`, persistence of `Run`/`RunNode`/`Artifact`, idempotency, cancellation — all
      validated against the **in-repo test double** (§7).
- [x] **Slice 1** (Auth + Onboarding + Agent room) — runs **no tests**, so it is **not blocked** at all
      (keystone §7, decision #3).
- [x] **Test Lab authoring**, **Integrations**, **Subscription**, **Knowledge upload** — independent of runs.

> Crystal-clear summary: **the only thing the missing chaos-proxy blocks is real-run orchestration and
> reports-from-real-runs.** Every other foundation slice — and all of the kernel/worker/streaming
> scaffolding itself — is built now behind the stable `TestKernel` port, then flipped to the real adapter
> the moment D1–D5 arrive, with zero changes to domain, application, API or UI.

---

## 6. Performance budgets owned by the kernel

| Budget | Target |
|--------|--------|
| `plan()` build (≤ 50 stages, pure CPU) | **< 50 ms** |
| Per-intent gRPC deadline | **30 s** default (`deadlineMs`), tunable per stage |
| Adapter overhead per node (emit→dispatch→map), excl. SUT time | **< 20 ms** |
| Per-run lanes (semaphore) | TEAM 3 / PRO 10 / ENT ∞ (cap 50) |
| chaos-proxy circuit-breaker trip | after N consecutive infra faults → fail run `FAILED` fast |

(Run-level budgets — enqueue latency, event fan-out, max concurrent runners — live in
`specs/runtime/run-lifecycle.md` §7.)

---

## 7. Test double (CI only — NOT a product MockRunner)

Decision #4 mandates **REAL execution from day 1 (no mock runner)** in the product: the default/only
**product-wired** adapter is the real chaos-proxy. To test the platform's own lifecycle without a live
proxy, the package ships an **in-repo contract fake** implementing `TestKernel`/`AgentPlugin` that replays
scripted `RunEvent`s. It is:
- used **exclusively** in automated unit/contract tests (Vitest/Cucumber-js, decision #12);
- **never** registered in any product composition root or deployed environment;
- gated so a build that wires it outside `test` fails CI.

This honors "no mock runner in the product" while keeping the lifecycle fully testable behind the port.

---

## 8. Deviations / clarifications (flagged per HARD RULES)

1. **`PlanNode` shape** defined here (§2) — keystone §5 references `PlanNode[]` but omits its fields; defined
   as the planning subset of the `RunNode` entity. No new enums/entities. Promote into keystone §5 verbatim.
2. **`createTestKernel` factory + config** (`maxLanes`, `resumeCompleted`, `deadlineMs`, `tls`,
   `chaosProxyEndpoint`) is **new construction surface**, introduced to keep per-run policy out of the
   **frozen** `TestKernel` method signatures. No frozen method/type changed.
3. **gRPC proto service/message names** (`ChaosProxy`, `ExecuteIntentMsg`, …) are the owner's to own; names
   here are placeholders to be replaced by the real `.proto` (D2). The TS-level `ExecuteIntent`/`IntentResult`
   the platform consumes remain the keystone §5 shapes verbatim.
4. **In-repo test double** (§7) is a testing seam, not a product runner — explicitly reconciled with
   decision #4 ("no mock runner").
```
