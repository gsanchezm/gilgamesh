import { useState, type FormEvent } from 'react';
import { Button } from '@gilgamesh/ui';
import type { AuthClient, LoginResult } from '../lib/auth-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginScreenProps {
  authClient: AuthClient;
  onSuccess: (result: LoginResult) => void;
  onForgot?: () => void;
  onCreate?: () => void;
}

export function LoginScreen({ authClient, onSuccess, onForgot, onCreate }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
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
    <main className="gx-login">
      <div>
        <div className="gx-login__brand">
          <div className="gx-login__mark" aria-hidden />
          <h1 className="gx-login__title">GILGAMESH</h1>
          <p className="gx-login__tagline">TESTING · TRUSTED · ELEVATED</p>
        </div>

        <form className="gx-login__form" onSubmit={handleSubmit} noValidate>
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
              <button
                type="button"
                className="gx-field__reveal"
                onClick={() => setShowPass((s) => !s)}
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {error ? (
            <p role="alert" className="gx-login__error">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <button type="button" className="gx-login__link" onClick={onForgot}>
            Forgot your password?
          </button>
          <Button type="button" variant="secondary">
            SSO · SAML
          </Button>
          <button type="button" className="gx-login__link" onClick={onCreate}>
            Create account
          </button>
        </form>
      </div>
    </main>
  );
}
