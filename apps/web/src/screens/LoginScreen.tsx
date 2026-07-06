import { useState, type FormEvent } from 'react';
import type { AuthClient, LoginResult } from '../lib/auth-client';
import { AuthHero } from './AuthHero';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Full-page navigation (not fetch): the OAuth dance is a top-level redirect chain, and the
// session lands as an httpOnly Set-Cookie on the callback's 302 back into the SPA.
export const GOOGLE_SSO_START_URL = '/api/v1/auth/sso/google/start';

// `?sso=` rides the server's redirect back to /login (slice 15): friendly English notices.
const SSO_NOTICES: Record<string, string> = {
  unavailable: 'Google sign-in is not available on this server yet. Use your email and password.',
  failed: 'Google sign-in did not complete. Try again or use your email and password.',
};

export interface LoginScreenProps {
  authClient: AuthClient;
  onSuccess: (result: LoginResult) => void;
  onForgot?: () => void;
  onCreate?: () => void;
  onViewPlans?: () => void;
  /** Raw `?sso=` query value (`unavailable` | `failed`) from the SSO redirect back-channel. */
  sso?: string | null;
}

export function LoginScreen({ authClient, onSuccess, onForgot, onCreate, onViewPlans, sso }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim()) || password.length < 1) {
      setError('Enter a valid email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await authClient.login({ email: email.trim(), password });
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gx-auth">
      <AuthHero />

      <section className="gx-auth__panel">
        <button type="button" className="gx-auth__viewplans" onClick={onViewPlans}>
          View plans →
        </button>

        <h1 className="gx-auth__title">Sign in</h1>
        <p className="gx-auth__sub">Access with your corporate email.</p>

        <form className="gx-auth__form" onSubmit={handleSubmit} noValidate>
          <label className="gx-field">
            <span className="gx-field__label">Corporate email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="gx-field">
            <span className="gx-field__label">Password</span>
            <span className="gx-field__password">
              <input
                type={showPass ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="gx-field__reveal" onClick={() => setShowPass((s) => !s)}>
                {showPass ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          <div className="gx-auth__row">
            <label className="gx-checkbox">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember me</span>
            </label>
            <button type="button" className="gx-login__link" onClick={onForgot}>
              Forgot your password?
            </button>
          </div>

          {error ? (
            <p role="alert" className="gx-login__error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="gx-btn gx-btn--primary gx-auth__enter" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Enter'} <span aria-hidden="true">→</span>
          </button>

          <div className="gx-auth__divider">
            <span>or continue with</span>
          </div>
          {sso && SSO_NOTICES[sso] ? (
            <p role="alert" className="gx-login__error">
              {SSO_NOTICES[sso]}
            </p>
          ) : null}
          <div className="gx-auth__providers">
            <a className="gx-btn gx-btn--secondary" href={GOOGLE_SSO_START_URL}>
              Google
            </a>
            <button type="button" className="gx-btn gx-btn--secondary" disabled title="Coming soon">
              SSO · SAML
            </button>
          </div>

          <p className="gx-auth__foot">
            No account yet?{' '}
            <button type="button" className="gx-auth__footlink" onClick={onCreate}>
              Create account
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
