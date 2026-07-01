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
  { src: '/assets/platforms/platform-android.svg', alt: 'Android', top: '9%', left: '57%', delay: '0s' },
  { src: '/assets/tools/tool-pixelmatch.png', alt: 'Visual', top: '22%', left: '20%', delay: '0.8s' },
  { src: '/assets/tools/tool-playwright.png', alt: 'Playwright', top: '42%', left: '72%', delay: '1.6s' },
  { src: '/assets/browsers/browser-chrome.png', alt: 'Chromium', top: '58%', left: '10%', delay: '0.4s' },
  { src: '/assets/tools/tool-api.svg', alt: 'API', top: '70%', left: '82%', delay: '2s' },
  { src: '/assets/browsers/browser-firefox.png', alt: 'Firefox', top: '86%', left: '40%', delay: '1.2s' },
];

// Smooth double helix: two dense sine strands phase-shifted by π so they weave, spanning the hero
// (handoff capture 01) — replaces the earlier dashed zig-zag.
const HELIX_W = 620;
const HELIX_H = 1000;
function helixStrand(phase: number): string {
  const amp = 152;
  const cx = 310;
  const periods = 2.6;
  const steps = 168;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = cx + amp * Math.sin(t * periods * Math.PI * 2 + phase);
    const y = t * HELIX_H;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

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
        <svg className="gx-auth__helix" viewBox={`0 0 ${HELIX_W} ${HELIX_H}`} preserveAspectRatio="xMidYMid slice">
          <path className="gx-auth__strand gx-auth__strand--gold" d={helixStrand(0)} fill="none" />
          <path className="gx-auth__strand gx-auth__strand--blue" d={helixStrand(Math.PI)} fill="none" />
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
