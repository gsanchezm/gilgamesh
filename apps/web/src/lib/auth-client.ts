import { readCsrfToken } from './csrf';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  activeOrgId: string | null;
}

export interface MeResult {
  activeOrgId: string | null;
}

/** Port the UI depends on; the HTTP adapter below is swappable (and mockable in tests). */
export interface AuthClient {
  login(input: LoginInput): Promise<LoginResult>;
  /** Restores the current session from the httpOnly cookie. Resolves null when unauthenticated. */
  me(): Promise<MeResult | null>;
  /** Revokes the current session (server clears the cookie). */
  logout(): Promise<void>;
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

  async me() {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('Could not restore the session.');
    const body = (await res.json()) as { activeOrgId: string | null };
    return { activeOrgId: body.activeOrgId };
  },

  async logout() {
    const res = await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Could not sign out.');
  },
};
