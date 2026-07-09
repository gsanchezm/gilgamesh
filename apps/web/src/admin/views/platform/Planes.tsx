import { useState } from 'react';
import { useAdmin } from '../../AdminContext';
import type { PlanCard, PlanKey } from '../../data/types';
import { fmtUsd } from '../../util';
import './Planes.css';

/** Margin (0..1) → the status colour of the bar + percentage (green ≥70%, amber ≥45%, red <45%). */
function marginColor(pct: number): string {
  if (pct >= 70) return '#3FB07A';
  if (pct >= 45) return '#C08A2E';
  return '#E0738A';
}

/** Gross margin as a whole-integer percentage: (price − cost) / price. */
function marginPct(price: number, cost: number): number {
  if (price <= 0) return 0;
  return Math.round(((price - cost) / price) * 100);
}

function PlanCardView({
  card,
  price,
  onPrice,
  t,
}: {
  card: PlanCard;
  price: number;
  onPrice: (plan: PlanKey, value: number) => void;
  t: (k: string) => string;
}) {
  const cost = card.costoEstPorClienteUsd;
  const pct = marginPct(price, cost);
  const color = marginColor(pct);
  const planName = t(`plan.${card.plan}`);
  const badgeLabel = card.esContrato ? t('planes.badge_ventas') : t('planes.badge_publico');

  return (
    <article
      className={`gx-adm-planes-card${card.destacado ? ' gx-adm-planes-card--featured' : ''}`}
      data-plan={card.plan}
    >
      {card.destacado && <span className="gx-adm-badge gx-adm-planes-badge--float">{badgeLabel}</span>}

      <div className="gx-adm-planes-head">
        <span className="gx-adm-planes-name">{planName}</span>
        {!card.destacado && <span className="gx-adm-badge">{badgeLabel}</span>}
      </div>

      <div>
        <span className="gx-adm-planes-eyebrow">
          {card.esContrato ? t('planes.contract_label') : t('planes.price_label')}
        </span>
        <div className="gx-adm-planes-field">
          <span className="gx-adm-planes-currency">$</span>
          <input
            className="gx-adm-planes-input"
            type="number"
            min={0}
            value={price}
            aria-label={`${t('planes.price_aria')} ${planName}`}
            onChange={(e) => onPrice(card.plan, Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)}
          />
          <span className="gx-adm-planes-mo">{t('common.mo')}</span>
        </div>
      </div>

      <ul className="gx-adm-planes-features">
        {card.features.map((f) => (
          <li key={f}>{t(f)}</li>
        ))}
      </ul>

      <div className="gx-adm-planes-foot">
        <div className="gx-adm-planes-row">
          <span>{t('planes.cost_label')}</span>
          <span className="gx-adm-planes-row__val">{fmtUsd(cost)}</span>
        </div>
        <div className="gx-adm-planes-row gx-adm-planes-marginrow">
          <span>{t('planes.margin_label')}</span>
          <span className="gx-adm-planes-marginpct" style={{ color }} data-testid="margin-pct">
            {pct}%
          </span>
        </div>
        <div className="gx-adm-meter" aria-hidden="true">
          <span
            className="gx-adm-meter__fill"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
          />
        </div>
      </div>
    </article>
  );
}

export function Planes() {
  const { t, service, showToast } = useAdmin();
  const cards = service.getPlanes();
  // Edited prices held in local state (spec §6 `planPrices`), seeded from the catalogue price.
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(cards.map((c) => [c.plan, c.precioMensualUsd])),
  );

  const onPrice = (plan: PlanKey, value: number) => setPrices((p) => ({ ...p, [plan]: value }));

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('planes.title')}</h1>
        <p className="gx-adm-sub">{t('planes.subtitle')}</p>
      </header>

      <button type="button" className="gx-adm-planes-publish" onClick={() => showToast(t('planes.published'))}>
        {t('planes.publish')}
      </button>

      <div className="gx-adm-planes-grid">
        {cards.map((card) => (
          <PlanCardView
            key={card.plan}
            card={card}
            price={prices[card.plan] ?? card.precioMensualUsd}
            onPrice={onPrice}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
