import { useState, type FormEvent } from 'react';
import type { AuthClient } from '../lib/auth-client';
import { AuthHero } from './AuthHero';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12; // mirrors the API @MinLength(12) / MIN_PASSWORD_LENGTH

export interface RegisterScreenProps {
  authClient: AuthClient;
  /** Called after a successful register. The company is carried to onboarding (becomes the Org name). */
  onSuccess: (company: string) => void;
  onSignIn?: () => void;
  onViewPlans?: () => void;
}

export function RegisterScreen({ authClient, onSuccess, onSignIn, onViewPlans }: RegisterScreenProps) {
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim() || !company.trim() || !email.trim()) {
      setError('Please complete all required fields.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid corporate email.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authClient.register({
        firstName: firstName.trim(),
        middleName: middleName.trim() || undefined,
        lastName: lastName.trim(),
        email: email.trim(),
        password,
      });
      onSuccess(company.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
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

        <h1 className="gx-auth__title">Create account</h1>
        <p className="gx-auth__sub">Start your workspace with your corporate email.</p>

        <form className="gx-auth__form gx-auth__form--wide" onSubmit={handleSubmit} noValidate>
          <div className="gx-auth__pair">
            <label className="gx-field">
              <span className="gx-field__label">First name</span>
              <input
                name="firstName"
                autoComplete="given-name"
                placeholder="Gabriel"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </label>
            <label className="gx-field">
              <span className="gx-field__label">Middle name</span>
              <input
                name="middleName"
                autoComplete="additional-name"
                placeholder="Optional"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
              />
            </label>
          </div>

          <div className="gx-auth__pair">
            <label className="gx-field">
              <span className="gx-field__label">Last name</span>
              <input
                name="lastName"
                autoComplete="family-name"
                placeholder="Sánchez"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
            <label className="gx-field">
              <span className="gx-field__label">Company</span>
              <input
                name="company"
                autoComplete="organization"
                placeholder="Acme Inc."
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
          </div>

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

          <div className="gx-auth__pair">
            <label className="gx-field">
              <span className="gx-field__label">Password</span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="gx-field">
              <span className="gx-field__label">Confirm password</span>
              <input
                type="password"
                name="confirm"
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>

          {error ? (
            <p role="alert" className="gx-login__error">
              {error}
            </p>
          ) : null}

          <button type="submit" className="gx-btn gx-btn--primary gx-auth__enter" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'} <span aria-hidden="true">→</span>
          </button>

          <p className="gx-auth__foot">
            Already have an account?{' '}
            <button type="button" className="gx-auth__footlink" onClick={onSignIn}>
              Sign in
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
