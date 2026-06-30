import { summarizeRun } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { RunEvent, RunPlan, TestKernel } from '../ports/kernel';
import type {
  ResultStatus,
  RunRecord,
  RunResultRecord,
  RunStatus,
  RunTargetKind,
  ScenarioRecord,
  TestCaseStatus,
} from '../ports/records';
import type {
  AuditLogRepository,
  FeatureRepository,
  MembershipRepository,
  ProjectRepository,
  RunRepository,
  RunResultRepository,
  ScenarioRepository,
  TestCaseRepository,
} from '../ports/repositories';
import type { UnitOfWork } from '../ports/unit-of-work';
import { requireProjectAccess } from './authz';

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const READERS = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
/** Map a kernel result onto the Test Lab's status field so the lab shows the last outcome. */
const REFLECT: Record<ResultStatus, TestCaseStatus> = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIPPED' };

export interface RunResultView {
  refId: string;
  name: string;
  status: ResultStatus;
  log: string[];
}

export interface RunSummaryView {
  id: string;
  projectId: string;
  status: RunStatus;
  targetKind: RunTargetKind;
  targetId: string;
  runLabel: string | null;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  ratePct: number;
  durationMs: number;
  createdAt: Date;
}

export interface RunView extends RunSummaryView {
  results: RunResultView[];
}

function runSummary(run: RunRecord): RunSummaryView {
  return {
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    targetKind: run.targetKind,
    targetId: run.targetId,
    runLabel: run.runLabel,
    passed: run.passed ?? 0,
    failed: run.failed ?? 0,
    skipped: run.skipped ?? 0,
    total: run.total ?? 0,
    ratePct: run.ratePct ?? 0,
    durationMs: run.durationMs ?? 0,
    createdAt: run.createdAt,
  };
}

function runView(run: RunRecord, results: RunResultRecord[]): RunView {
  return {
    ...runSummary(run),
    results: results.map((r) => ({ refId: r.refId, name: r.name, status: r.status, log: r.log })),
  };
}

interface CollectedResult {
  refId: string;
  name: string;
  status: ResultStatus;
  log: string[];
}

/** Drain the kernel's event stream into per-unit results + the run duration. */
async function collect(events: AsyncIterable<RunEvent>): Promise<{ results: CollectedResult[]; durationMs: number }> {
  const results: CollectedResult[] = [];
  let durationMs = 0;
  for await (const ev of events) {
    if (ev.type === 'RESULT') {
      results.push({ refId: ev.refId, name: ev.name, status: ev.status, log: [] });
    } else if (ev.type === 'LOG') {
      // Trailing log lines belong to the unit just reported (the initial 'sys' line precedes any result).
      if (results.length > 0) results[results.length - 1]!.log.push(ev.text);
    } else {
      durationMs = ev.durationMs;
    }
  }
  return { results, durationMs };
}

interface ReadRunDeps {
  runs: RunRepository;
  runResults: RunResultRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
}

interface RunDeps extends ReadRunDeps {
  uow: UnitOfWork;
  kernel: TestKernel;
  features: FeatureRepository;
  scenarios: ScenarioRepository;
  testCases: TestCaseRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

export class TriggerRun {
  constructor(private readonly deps: RunDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    targetKind: RunTargetKind;
    targetId: string;
    runLabel?: string;
  }): Promise<RunView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const runId = this.deps.ids.next();

    let plan: RunPlan;
    let scenarios: ScenarioRecord[] = [];
    let testCaseId: string | null = null;
    if (input.targetKind === 'FEATURE') {
      const feature = await this.deps.features.findById(input.targetId);
      if (!feature || feature.projectId !== project.id) throw new ApplicationError('NOT_FOUND', 'Feature not found.');
      scenarios = await this.deps.scenarios.listForFeature(feature.id);
      plan = {
        runId,
        target: {
          kind: 'FEATURE',
          featureId: feature.id,
          name: feature.name,
          scenarios: scenarios.map((s) => ({ id: s.id, name: s.name })),
        },
      };
    } else {
      const tc = await this.deps.testCases.findById(input.targetId);
      if (!tc || tc.projectId !== project.id) throw new ApplicationError('NOT_FOUND', 'Test case not found.');
      testCaseId = tc.id;
      plan = { runId, target: { kind: 'TESTCASE', testCaseId: tc.id, name: tc.title } };
    }

    // Execute synchronously through the (stub) kernel, folding the event stream into results.
    const { results, durationMs } = await collect(this.deps.kernel.run(plan).events);
    const summary = summarizeRun(results.map((r) => r.status));
    const now = this.deps.clock.now();

    const run: RunRecord = {
      id: runId,
      orgId: project.orgId,
      projectId: project.id,
      status: summary.status,
      trigger: 'MANUAL',
      targetKind: input.targetKind,
      targetId: input.targetId,
      runLabel: input.runLabel ?? null,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      total: summary.total,
      ratePct: summary.ratePct,
      durationMs,
      createdById: input.userId,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
    };
    const resultRecords: RunResultRecord[] = results.map((r, i) => ({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      runId,
      refId: r.refId,
      name: r.name,
      status: r.status,
      log: r.log,
      order: i,
    }));

    // Run row + results + the lastStatus/status reflection commit atomically.
    await this.deps.uow.transaction(async (repos) => {
      await repos.runs.create(run);
      await repos.runResults.createMany(resultRecords);
      if (input.targetKind === 'FEATURE') {
        // Update each scenario's lastStatus IN PLACE by id (a no-op if it was concurrently deleted),
        // never rewriting the whole set from the pre-kernel snapshot — that would clobber a feature
        // edit that committed during the run's I/O window (lost update).
        for (const r of results) {
          await repos.scenarios.setLastStatus(r.refId, REFLECT[r.status]);
        }
      } else if (testCaseId) {
        const tc = await repos.testCases.findById(testCaseId);
        if (tc) await repos.testCases.save({ ...tc, status: REFLECT[results[0]!.status], updatedAt: now });
      }
    });

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'run.created',
      targetType: 'Run',
      targetId: runId,
      metadata: { targetKind: input.targetKind, status: run.status, total: summary.total },
      ip: null,
      createdAt: now,
    });

    return runView(run, resultRecords);
  }
}

export class ListRuns {
  constructor(private readonly deps: ReadRunDeps) {}

  async execute(input: { userId: string; projectId: string }): Promise<RunSummaryView[]> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...READERS]);
    const runs = await this.deps.runs.listForProject(project.id);
    return runs.map(runSummary);
  }
}

export class GetRun {
  constructor(private readonly deps: ReadRunDeps) {}

  async execute(input: { userId: string; runId: string }): Promise<RunView> {
    const run = await this.deps.runs.findById(input.runId);
    if (!run) throw new ApplicationError('NOT_FOUND', 'Run not found.');
    await requireProjectAccess(this.deps, input.userId, run.projectId, [...READERS]);
    const results = await this.deps.runResults.listForRun(run.id);
    return runView(run, results);
  }
}
