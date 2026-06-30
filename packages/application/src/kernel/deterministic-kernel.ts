import type { ResultStatus } from '../ports/records';
import type { RunEvent, RunPlan, RunPlanScenario, TestKernel } from '../ports/kernel';

/**
 * Offline, reproducible {@link TestKernel} stub for slice 3 (the Brain-stub pattern of slice 2). It
 * derives a deterministic outcome from each unit's name — names containing "fail" → FAIL, "skip"/"wip"
 * → SKIP, otherwise PASS — and streams `RunEvent`s. No `Date.now`/`Math.random`/network, so identical
 * plans yield identical runs. The real chaos-proxy adapter replaces this in the Orchestration slice.
 */
const FIXED_AT = '1970-01-01T00:00:00.000Z';

function outcome(name: string): ResultStatus {
  const n = name.toLowerCase();
  if (n.includes('fail')) return 'FAIL';
  if (n.includes('skip') || n.includes('wip')) return 'SKIP';
  return 'PASS';
}

export class DeterministicKernel implements TestKernel {
  run(plan: RunPlan): { runId: string; events: AsyncIterable<RunEvent> } {
    return { runId: plan.runId, events: this.stream(plan) };
  }

  private async *stream(plan: RunPlan): AsyncIterable<RunEvent> {
    const units: RunPlanScenario[] =
      plan.target.kind === 'FEATURE'
        ? plan.target.scenarios
        : [{ id: plan.target.testCaseId, name: plan.target.name }];

    yield { type: 'LOG', level: 'sys', text: `run ${plan.runId} started`, at: FIXED_AT };

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const unit of units) {
      const status = outcome(unit.name);
      if (status === 'PASS') passed += 1;
      else if (status === 'FAIL') failed += 1;
      else skipped += 1;
      yield { type: 'RESULT', refId: unit.id, name: unit.name, status };
      const level = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'log';
      yield { type: 'LOG', level, text: `${unit.name}: ${status}`, at: FIXED_AT };
    }

    const total = units.length;
    yield { type: 'DONE', passed, failed, skipped, total, durationMs: total * 5 };
  }
}
