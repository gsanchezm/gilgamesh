import type { ResultStatus } from './records';

/**
 * The execution seam (keystone §5/§6 `TestKernel`). A run plan is handed to `run`, which returns a
 * `runId` and an async stream of `RunEvent`s the caller folds into the persisted `Run` + results.
 *
 * Slice 3 wires a **deterministic stub** adapter (offline, reproducible) and consumes the stream
 * synchronously to completion — no chaos-proxy, SUT, queue, or network. The real chaos-proxy gRPC
 * adapter + SSE streaming + DAG `RunNode`s land in the Orchestration slice (keystone §7).
 */
export interface RunPlanScenario {
  id: string;
  name: string;
}

export type RunPlanTarget =
  | { kind: 'FEATURE'; featureId: string; name: string; scenarios: RunPlanScenario[] }
  | { kind: 'TESTCASE'; testCaseId: string; name: string };

export interface RunPlan {
  runId: string;
  target: RunPlanTarget;
}

export type RunEvent =
  | { type: 'LOG'; level: 'sys' | 'run' | 'pass' | 'fail' | 'log'; text: string; at: string }
  | { type: 'RESULT'; refId: string; name: string; status: ResultStatus }
  | { type: 'DONE'; passed: number; failed: number; skipped: number; total: number; durationMs: number };

export interface TestKernel {
  run(plan: RunPlan): { runId: string; events: AsyncIterable<RunEvent> };
}
