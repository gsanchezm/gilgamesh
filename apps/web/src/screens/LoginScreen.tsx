import { useState, type FormEvent } from 'react';
import type { AuthClient, LoginResult } from '../lib/auth-client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginScreenProps {
  authClient: AuthClient;
  onSuccess: (result: LoginResult) => void;
  onForgot?: () => void;
  onCreate?: () => void;
  onViewPlans?: () => void;
}

// Tool / browser / platform marks that orbit the hero helix (handoff login, capture 01).
const HERO_CHIPS = [
  { src: '/assets/platforms/platform-android.svg', alt: 'Android', top: '8%', left: '58%', delay: '0s' },
  { src: '/assets/tools/tool-pixelmatch.png', alt: 'Visual', top: '20%', left: '22%', delay: '0.8s' },
  { src: '/assets/tools/tool-playwright.png', alt: 'Playwright', top: '40%', left: '70%', delay: '1.6s' },
  { src: '/assets/browsers/browser-chrome.png', alt: 'Chromium', top: '62%', left: '30%', delay: '0.4s' },
  { src: '/assets/tools/tool-api.svg', alt: 'API', top: '66%', left: '66%', delay: '2s' },
  { src: '/assets/browsers/browser-firefox.png', alt: 'Firefox', top: '82%', left: '46%', delay: '1.2s' },
];

export function LoginScreen({ authClient, onSuccess, onForgot, onCreate, onViewPlans }: LoginScreenProps) {
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
      <aside className="gx-auth__hero" aria-hidden="true">
        <svg className="gx-auth__helix" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
          <path
            className="gx-auth__strand gx-auth__strand--gold"
            d="M130,-20 C 300,140 60,260 200,400 C 340,540 100,660 190,820"
            fill="none"
          />
          <path
            className="gx-auth__strand gx-auth__strand--blue"
            d="M270,-20 C 100,140 340,260 200,400 C 60,540 300,660 210,820"
            fill="none"
          />
        </svg>
        {HERO_CHIPS.map((c) => (
          <span
            key={c.alt}
            className="gx-auth__chip"
            style={{ top: c.top, left: c.left, animationDelay: c.delay }}
          >
            <img src={c.src} alt="" />
          </span>
        ))}
        <div className="gx-auth__brand">
          <div className="gx-auth__mark" style={{ backgroundImage: 'url(/assets/brand/mark-dark.png)' }} />
          <div className="gx-auth__logo">GILGAMESH</div>
          <div className="gx-auth__tagline">Testing · Trusted · Elevated</div>
          <p className="gx-auth__herotext">
            A QA team of agents with real identity, ready to awaken and orchestrate your tests.
          </p>
        </div>
      </aside>

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
          <div className="gx-auth__providers">
            <button type="button" className="gx-btn gx-btn--secondary" disabled title="Coming soon">
              Google
            </button>
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
