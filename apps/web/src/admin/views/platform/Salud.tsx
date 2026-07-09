import { useAdmin } from '../../AdminContext';
import type { Incidente, Kpi, Pool } from '../../data/types';
import { pctWidth, relTime } from '../../util';
import './Salud.css';

// Pool display strings → common.ts destino keys (read-only), so EN says "emulator".
const POOL_KEY: Record<string, string> = {
  Chromium: 'destino.chromium',
  Firefox: 'destino.firefox',
  'Android · emulador': 'destino.android-emu',
};
const POOL_COLOR: Record<string, string> = {
  Chromium: '#3F6FA3',
  Firefox: '#C0704A',
  'Android · emulador': '#2F8F5B',
};
const INC_COLOR: Record<string, string> = {
  monitoreando: '#C08A2E',
  resuelto: '#3FB07A',
};

/** Tone → the colour of a KPI value (uptime green, open-incidents amber). */
function toneColor(tone: Kpi['tone']): string | undefined {
  if (tone === 'positive') return '#3FB07A';
  if (tone === 'warn') return '#C08A2E';
  return undefined;
}

function KpiCard({ kpi, t }: { kpi: Kpi; t: (k: string) => string }) {
  return (
    <article className="gx-adm-kpi">
      <span className="gx-adm-kpi__label">{t(kpi.label)}</span>
      <span className="gx-adm-kpi__value" style={{ color: toneColor(kpi.tone) }}>
        {kpi.value}
      </span>
    </article>
  );
}

function PoolRow({ pool, t }: { pool: Pool; t: (k: string) => string }) {
  const poolKey = POOL_KEY[pool.nombre];
  const label = poolKey ? t(poolKey) : pool.nombre;
  const color = POOL_COLOR[pool.nombre] ?? 'var(--muted)';
  return (
    <li data-ext={pool.externo ? 'true' : undefined}>
      <div className="gx-adm-salud-poolhead">
        <span className="gx-adm-salud-poolname">
          {label}
          {pool.externo ? ` — ${t('common.externo')}` : ''}
        </span>
        {!pool.externo && (
          <span className="gx-adm-salud-poolworkers">
            {pool.workersOcupados} / {pool.workersTotal} {t('salud.workers')}
          </span>
        )}
      </div>
      {pool.externo ? (
        <div className="gx-adm-salud-dotted" aria-hidden="true" />
      ) : (
        <div className="gx-adm-meter" aria-hidden="true">
          <span
            className="gx-adm-meter__fill"
            style={{ width: pctWidth(pool.workersOcupados, pool.workersTotal), background: color }}
          />
        </div>
      )}
      <span className="gx-adm-salud-poolmeta">
        {pool.region} · {pool.version}
      </span>
    </li>
  );
}

function IncRow({ inc, t, lang }: { inc: Incidente; t: (k: string) => string; lang: 'es' | 'en' }) {
  const color = INC_COLOR[inc.estado] ?? '#8597B4';
  const meta =
    inc.estado === 'resuelto' ? `${t('salud.inc_resolved_in')} ${inc.duracion}` : relTime(lang, inc.inicio);
  return (
    <li>
      <span className="gx-adm-salud-incid">{inc.id}</span>
      <span className="gx-adm-salud-inctitle">{t(inc.titulo)}</span>
      <span className="gx-adm-status" style={{ color }}>
        <span className="gx-adm-status__dot" style={{ background: color }} />
        {t(`incidente.${inc.estado}`)}
      </span>
      <span className="gx-adm-salud-incmeta">{meta}</span>
    </li>
  );
}

export function Salud() {
  const { t, lang, service } = useAdmin();
  const data = service.getSalud();

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('salud.title')}</h1>
        <p className="gx-adm-sub">{t('salud.subtitle')}</p>
      </header>

      <div className="gx-adm-kpirow">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Pools de runners */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('salud.pools_title')}</span>
        <ul className="gx-adm-salud-pools">
          {data.pools.map((p) => (
            <PoolRow key={p.nombre} pool={p} t={t} />
          ))}
        </ul>
      </section>

      {/* Uptime · últimos 30 días */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('salud.uptime_title')}</span>
        <div className="gx-adm-salud-uptime">
          {data.uptimeDias.map((state, i) => (
            <span
              key={i}
              className="gx-adm-salud-cell"
              data-state={state}
              title={t(state === 'ok' ? 'salud.uptime_ok' : 'salud.uptime_degradado')}
            />
          ))}
        </div>
      </section>

      {/* Incidentes */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('salud.inc_title')}</span>
        <ul className="gx-adm-salud-inc">
          {data.incidentes.map((inc) => (
            <IncRow key={inc.id} inc={inc} t={t} lang={lang} />
          ))}
        </ul>
      </section>
    </div>
  );
}
