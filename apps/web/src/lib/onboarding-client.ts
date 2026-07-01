import { readCsrfToken } from './csrf';
import { API_BASE } from './http';

export type ProjectFormat = 'BDD' | 'TRADITIONAL';
export type RepoProvider = 'github' | 'bitbucket' | 'ado';

export interface CreateProjectInput {
  projectName: string;
  format: ProjectFormat;
  repoProvider?: RepoProvider;
}

export interface CreateProjectResult {
  projectId: string;
  slug: string;
}

export interface OnboardingClient {
  createProject(input: CreateProjectInput): Promise<CreateProjectResult>;
}

export const httpOnboardingClient: OnboardingClient = {
  async createProject(input) {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(problem.detail ?? 'Could not create the project.');
    }
    return (await res.json()) as CreateProjectResult;
  },
};
