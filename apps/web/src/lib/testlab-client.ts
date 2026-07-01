import { getJson, sendJson } from './http';

export type TestCasePriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type ProjectFormat = 'BDD' | 'TRADITIONAL';

export interface SliceView {
  id: string;
  key: string;
  name: string;
  order: number;
}

export interface ScenarioView {
  name: string;
  order: number;
  lastStatus: string | null;
}

export interface FeatureSummaryView {
  id: string;
  name: string;
  path: string;
  sliceId: string | null;
  scenarioCount: number;
}

export interface FeatureView {
  id: string;
  name: string;
  path: string;
  sliceId: string | null;
  content: string;
  scenarios: ScenarioView[];
}

export interface TestCaseView {
  id: string;
  key: string;
  title: string;
  steps: string;
  data: string;
  expected: string;
  priority: TestCasePriority;
  status: string;
  sliceId: string | null;
  assignedAgentId: string | null;
}

export interface GeneratedDraftsView {
  features: { name: string; path: string; content: string }[];
  testCases: { title: string; steps: string; data: string; expected: string; priority: TestCasePriority }[];
}

export interface TestLabClient {
  listSlices(projectId: string): Promise<SliceView[]>;
  createSlice(projectId: string, input: { key: string; name: string }): Promise<SliceView>;
  listFeatures(projectId: string): Promise<FeatureSummaryView[]>;
  getFeature(featureId: string): Promise<FeatureView>;
  createFeature(projectId: string, input: { path: string; content: string; sliceId?: string }): Promise<FeatureView>;
  listTestCases(projectId: string): Promise<TestCaseView[]>;
  createTestCase(
    projectId: string,
    input: { title: string; priority: TestCasePriority; steps?: string; expected?: string; sliceId?: string },
  ): Promise<TestCaseView>;
  generate(
    projectId: string,
    input: { prompt: string; format?: ProjectFormat; count?: number },
  ): Promise<GeneratedDraftsView>;
}

export const httpTestLabClient: TestLabClient = {
  listSlices: (projectId) => getJson(`/projects/${projectId}/slices`, 'Could not load slices.'),
  createSlice: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/slices`, input, 'Could not create the slice.'),
  listFeatures: (projectId) => getJson(`/projects/${projectId}/features`, 'Could not load features.'),
  getFeature: (featureId) => getJson(`/features/${featureId}`, 'Could not load the feature.'),
  createFeature: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/features`, input, 'Could not create the feature.'),
  listTestCases: (projectId) => getJson(`/projects/${projectId}/test-cases`, 'Could not load test cases.'),
  createTestCase: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/test-cases`, input, 'Could not create the test case.'),
  generate: (projectId, input) =>
    sendJson('POST', `/projects/${projectId}/test-cases/generate`, input, 'Could not generate drafts.'),
};
