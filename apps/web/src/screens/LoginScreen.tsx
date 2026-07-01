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

// Hero double helix (handoff capture 01): two phase-shifted sine strands that weave around a tilted
// axis, DNA-style rungs between them, and tool marks riding the strands (so they follow the flow).
// All coordinates are in the SVG viewBox.
const HELIX_W = 600;
const HELIX_H = 900;
const AMP = 132;
const CX = 300;
const PERIODS = 2.3;
const LEAN = 168; // diagonal incline: the axis drifts across as the helix descends

function strandX(t: number, phase: number): number {
  return CX + AMP * Math.sin(t * PERIODS * Math.PI * 2 + phase) + LEAN * (t - 0.5);
}
function strandPath(phase: number): string {
  const steps = 150;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    d += `${i === 0 ? 'M' : 'L'}${strandX(t, phase).toFixed(1)} ${(t * HELIX_H).toFixed(1)} `;
  }
  return d.trim();
}
// Rungs at even intervals (the "intermediate lines" of the ladder).
const RUNGS = Array.from({ length: 16 }, (_, k) => (k + 0.5) / 16);
// Tool marks placed along the visible helix, ringing the brand (handoff capture 01) without landing
// on the wordmark. Positions are % within the hero.
const HERO_CHIPS = [
  { src: '/assets/platforms/platform-android.svg', top: '4%', left: '46%' },
  { src: '/assets/tools/tool-pixelmatch.png', top: '23%', left: '15%' },
  { src: '/assets/tools/tool-playwright.png', top: '44%', left: '6%' },
  { src: '/assets/tools/tool-api.svg', top: '52%', left: '63%' },
  { src: '/assets/browsers/browser-chrome.png', top: '80%', left: '22%' },
  { src: '/assets/browsers/browser-firefox.png', top: '90%', left: '46%' },
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
        <svg className="gx-auth__helix" viewBox={`0 0 ${HELIX_W} ${HELIX_H}`} preserveAspectRatio="xMidYMid slice">
          {RUNGS.map((t) => (
            <line
              key={t}
              className="gx-auth__rung"
              x1={strandX(t, 0).toFixed(1)}
              y1={(t * HELIX_H).toFixed(1)}
              x2={strandX(t, Math.PI).toFixed(1)}
              y2={(t * HELIX_H).toFixed(1)}
            />
          ))}
          <path className="gx-auth__strand gx-auth__strand--gold" d={strandPath(0)} fill="none" />
          <path className="gx-auth__strand gx-auth__strand--blue" d={strandPath(Math.PI)} fill="none" />
        </svg>
        {HERO_CHIPS.map((c) => (
          <span key={c.src} className="gx-auth__chip" style={{ top: c.top, left: c.left }}>
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
