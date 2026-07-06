import { useState, type FormEvent } from 'react';
import type { AuthClient } from '../lib/auth-client';
import { AuthHero } from './AuthHero';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ForgotPasswordScreenProps {
  authClient: AuthClient;
  onSignIn?: () => void;
}

/**
 * Slice 12 (spec §7.2): request a reset link. After a successful submit the screen shows the
 * SAME generic confirmation for every email — it never distinguishes outcomes (AC-AUTH-10).
 */
export function ForgotPasswordScreen({ authClient, onSignIn }: ForgotPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email.');
      return;
    }
    setSubmitting(true);
    try {
      await authClient.forgotPassword({ email: email.trim() });
      setSent(true);
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
        <h1 className="gx-auth__title">Forgot password</h1>
        <p className="gx-auth__sub">Enter your corporate email and we&rsquo;ll send you a reset link.</p>

        {sent ? (
          <div className="gx-recovery__confirm" role="status">
            <p className="gx-recovery__confirmText">
              If an account exists for that email, a reset link is on its way.
            </p>
            <p className="gx-recovery__hint">The link is valid for 30 minutes and can be used once.</p>
            <button type="button" className="gx-btn gx-btn--primary gx-auth__enter" onClick={onSignIn}>
              Back to sign in
            </button>
          </div>
        ) : (
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

            {error ? (
              <p role="alert" className="gx-login__error">
                {error}
              </p>
            ) : null}

            <button type="submit" className="gx-btn gx-btn--primary gx-auth__enter" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'} <span aria-hidden="true">→</span>
            </button>

            <p className="gx-auth__foot">
              Remembered it?{' '}
              <button type="button" className="gx-auth__footlink" onClick={onSignIn}>
                Back to sign in
              </button>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
