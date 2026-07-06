import { useState, type FormEvent } from 'react';
import type { AuthClient } from '../lib/auth-client';
import { AuthHero } from './AuthHero';

const MIN_PASSWORD_LENGTH = 12;

export interface ResetPasswordScreenProps {
  authClient: AuthClient;
  /** The raw token from the email link (`/reset-password?token=…`); null = a broken/missing link. */
  token: string | null;
  onSignIn?: () => void;
  onRequestNew?: () => void;
}

/**
 * Slice 12 (spec §7.3): set a new password with the emailed token. Success routes back to
 * sign-in (every old session was revoked); an invalid/expired/consumed token (422) offers
 * the request-a-new-link path.
 */
export function ResetPasswordScreen({ authClient, token, onSignIn, onRequestNew }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await authClient.resetPassword({ token: token ?? '', newPassword: password });
      setDone(true);
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
        <h1 className="gx-auth__title">Reset password</h1>

        {!token ? (
          <div className="gx-recovery__confirm" role="alert">
            <p className="gx-recovery__confirmText">That reset link is invalid or has expired.</p>
            <button type="button" className="gx-btn gx-btn--primary gx-auth__enter" onClick={onRequestNew}>
              Request a new link
            </button>
          </div>
        ) : done ? (
          <div className="gx-recovery__confirm" role="status">
            <p className="gx-recovery__confirmText">
              Your password has been reset. Every previous session was signed out.
            </p>
            <button type="button" className="gx-btn gx-btn--primary gx-auth__enter" onClick={onSignIn}>
              Go to sign in
            </button>
          </div>
        ) : (
          <>
            <p className="gx-auth__sub">Choose a new password for your account.</p>
            <form className="gx-auth__form" onSubmit={handleSubmit} noValidate>
              <label className="gx-field">
                <span className="gx-field__label">New password</span>
                <span className="gx-field__password">
                  <input
                    type={showPass ? 'text' : 'password'}
                    name="newPassword"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className="gx-field__reveal" onClick={() => setShowPass((s) => !s)}>
                    {showPass ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>

              <label className="gx-field">
                <span className="gx-field__label">Confirm password</span>
                <input
                  type={showPass ? 'text' : 'password'}
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>

              {error ? (
                <div className="gx-recovery__errorBlock">
                  <p role="alert" className="gx-login__error">
                    {error}
                  </p>
                  <button type="button" className="gx-auth__footlink" onClick={onRequestNew}>
                    Request a new link
                  </button>
                </div>
              ) : null}

              <button type="submit" className="gx-btn gx-btn--primary gx-auth__enter" disabled={submitting}>
                {submitting ? 'Saving…' : 'Set new password'} <span aria-hidden="true">→</span>
              </button>

              <p className="gx-auth__foot">
                Remembered it?{' '}
                <button type="button" className="gx-auth__footlink" onClick={onSignIn}>
                  Back to sign in
                </button>
              </p>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
