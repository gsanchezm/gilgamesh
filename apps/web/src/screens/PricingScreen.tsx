import { useState } from 'react';
import { displayPriceCents, PLAN_CATALOG, type PlanTier, type PricingCycle } from '@gilgamesh/domain';

export interface PricingScreenProps {
  /** Start the signup flow (every plan CTA + the top "Start free"). */
  onStart: () => void;
  onSignIn: () => void;
}

function usd(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function PlanCard({ tier, cycle, onStart }: { tier: PlanTier; cycle: PricingCycle; onStart: () => void }) {
  const price = usd(displayPriceCents(tier, cycle));
  const period =
    tier.monthlyCents === 0 ? 'forever' : cycle === 'annual' ? '/mo billed annually' : '/mo';

  return (
    <article className={`gx-plan${tier.highlight ? ' gx-plan--highlight' : ''}`}>
      {tier.highlight ? <span className="gx-plan__badge">Most popular</span> : null}
      <h3 className="gx-plan__name">{tier.name}</h3>
      <p className="gx-plan__tagline">{tier.tagline}</p>

      <div className="gx-plan__price">
        <span className="gx-plan__amount">{price}</span>
        <span className="gx-plan__period">{period}</span>
      </div>
      {tier.perExtraWorkspaceCents ? (
        <div className="gx-plan__extra">+ {usd(tier.perExtraWorkspaceCents)} / extra workspace</div>
      ) : null}

      <button
        type="button"
        className={`gx-btn ${tier.highlight ? 'gx-btn--primary' : 'gx-btn--secondary'} gx-plan__cta`}
        onClick={onStart}
      >
        {tier.ctaLabel}
      </button>

      <div className="gx-plan__divider" />

      {tier.inheritsFromName ? <p className="gx-plan__inherits">{tier.inheritsFromName}</p> : null}
      <ul className="gx-plan__features">
        {tier.features.map((f) => (
          <li key={f} className="gx-plan__feature">
            <span aria-hidden="true">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PricingScreen({ onStart, onSignIn }: PricingScreenProps) {
  const [cycle, setCycle] = useState<PricingCycle>('monthly');

  return (
    <div className="gx-pricing">
      <header className="gx-pricing__bar">
        <button type="button" className="gx-pricing__brand" onClick={onSignIn}>
          <span className="gx-pricing__mark" style={{ backgroundImage: 'url(/assets/brand/mark-dark.png)' }} />
          <span className="gx-pricing__wordmark">GILGAMESH</span>
        </button>
        <div className="gx-pricing__baractions">
          <button type="button" className="gx-pricing__signin" onClick={onSignIn}>
            Sign in
          </button>
          <button type="button" className="gx-btn gx-btn--primary gx-pricing__start" onClick={onStart}>
            Start free →
          </button>
        </div>
      </header>

      <section className="gx-pricing__hero">
        <div className="gx-pricing__eyebrow">Pricing</div>
        <h1 className="gx-pricing__title">
          Summon the pantheon that
          <br />
          fits your team
        </h1>
        <p className="gx-pricing__sub">
          Eleven specialist QA agents, parallel orchestration and layered HTML reports — and your results
          always stay inside Gilgamesh.
        </p>

        <div className="gx-pricing__toggle" role="group" aria-label="Billing cycle">
          <button
            type="button"
            aria-pressed={cycle === 'monthly'}
            onClick={() => setCycle('monthly')}
          >
            MONTHLY
          </button>
          <button type="button" aria-pressed={cycle === 'annual'} onClick={() => setCycle('annual')}>
            ANNUAL
          </button>
        </div>
        <p className="gx-pricing__save">
          {cycle === 'annual'
            ? 'You save 2 months — billed annually'
            : 'Switch to annual and get 2 months free'}
        </p>
      </section>

      <div className="gx-pricing__grid">
        {PLAN_CATALOG.map((tier) => (
          <PlanCard key={tier.id} tier={tier} cycle={cycle} onStart={onStart} />
        ))}
      </div>

      <p className="gx-pricing__foot">
        Every plan includes dark mode, an English UI, capture and layered HTML reports. Billed per active
        workspace — cancel anytime.
      </p>
    </div>
  );
}
