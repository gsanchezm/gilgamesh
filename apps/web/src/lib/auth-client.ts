import { readCsrfToken } from './csrf';
import { API_BASE } from './http';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  activeOrgId: string | null;
}

export interface RegisterInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  password: string;
}

export interface RegisterResult {
  userId: string;
}

export interface MeResult {
  activeOrgId: string | null;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/** Port the UI depends on; the HTTP adapter below is swappable (and mockable in tests). */
export interface AuthClient {
  login(input: LoginInput): Promise<LoginResult>;
  /**
   * Creates a User and auto-signs-in (the server sets the session + csrf cookies). No Org yet —
   * the tenant is bootstrapped later at onboarding (spec AC-AUTH-01).
   */
  register(input: RegisterInput): Promise<RegisterResult>;
  /** Restores the current session from the httpOnly cookie. Resolves null when unauthenticated. */
  me(): Promise<MeResult | null>;
  /** Revokes the current session (server clears the cookie). */
  logout(): Promise<void>;
  /**
   * Begins a password reset. Public + enumeration-safe: the server answers the same generic 202
   * whether or not the email exists, so success here never confirms an account (AC-AUTH-10).
   */
  forgotPassword(input: ForgotPasswordInput): Promise<void>;
  /** Completes a reset. Throws the Problem detail on an invalid/expired/consumed token (422). */
  resetPassword(input: ResetPasswordInput): Promise<void>;
}

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

  // Mirrors login (NOT the onboarding client): send credentials so the server can set the session
  // cookie, but NO X-CSRF-Token — registration establishes the session, so there is no token yet
  // (the /auth/register controller has no CsrfGuard).
  async register(input) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(problem.detail ?? 'Could not create your account.');
    }
    return (await res.json()) as RegisterResult;
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

  // Public pre-session endpoints (like login/register): no CSRF header, no session required.
  async forgotPassword(input) {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(problem.detail ?? 'Could not request the reset link. Please retry.');
    }
  },

  async resetPassword(input) {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const problem = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(problem.detail ?? 'That reset link is invalid or has expired.');
    }
  },
};
