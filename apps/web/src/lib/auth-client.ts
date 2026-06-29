export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  activeOrgId: string | null;
}

/** Port the UI depends on; the HTTP adapter below is swappable (and mockable in tests). */
export interface AuthClient {
  login(input: LoginInput): Promise<LoginResult>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const httpAuthClient: AuthClient = {
  async login(input) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(problem.detail ?? 'Invalid email or password.');
    }
    return (await res.json()) as LoginResult;
  },
};
