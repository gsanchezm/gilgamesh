import { getJson, sendJson } from './http';

export type RunStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
export type ResultStatus = 'PASS' | 'FAIL' | 'SKIP';
export type RunTargetKind = 'FEATURE' | 'TESTCASE';

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
  createdAt: string;
}

export interface RunView extends RunSummaryView {
  results: RunResultView[];
}

export interface RunsClient {
  triggerRun(
    projectId: string,
    input: { targetKind: RunTargetKind; targetId: string; runLabel?: string },
  ): Promise<RunView>;
  listRuns(projectId: string): Promise<RunSummaryView[]>;
  getRun(runId: string): Promise<RunView>;
}

export const httpRunsClient: RunsClient = {
  triggerRun: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/runs`, input, 'Could not start the run.'),
  listRuns: (projectId) => getJson(`/projects/${projectId}/runs`, 'Could not load runs.'),
  getRun: (runId) => getJson(`/runs/${runId}`, 'Could not load the run.'),
};
