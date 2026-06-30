import { readCsrfToken } from './csrf';

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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(problem.detail ?? fallback);
  }
  return (await res.json()) as T;
}

function getJson<T>(path: string, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { credentials: 'include' }).then((r) => ok<T>(r, fallback));
}

function sendJson<T>(method: string, path: string, body: unknown, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
    credentials: 'include',
    body: JSON.stringify(body),
  }).then((r) => ok<T>(r, fallback));
}

export const httpRunsClient: RunsClient = {
  triggerRun: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/runs`, input, 'Could not start the run.'),
  listRuns: (projectId) => getJson(`/projects/${projectId}/runs`, 'Could not load runs.'),
  getRun: (runId) => getJson(`/runs/${runId}`, 'Could not load the run.'),
};
