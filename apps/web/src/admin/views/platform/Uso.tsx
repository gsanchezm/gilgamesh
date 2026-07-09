import { useAdmin } from '../../AdminContext';
import type { Kpi } from '../../data/types';
import { fmtNum, fmtUsd, pctWidth } from '../../util';
import './Uso.css';

// Known runner-target display strings → common.ts destino keys (read-only), so EN says "emulator".
const DESTINO_KEY: Record<string, string> = {
  Chromium: 'destino.chromium',
  Firefox: 'destino.firefox',
  'Android · emulador': 'destino.android-emu',
};

function KpiCard({ kpi, t }: { kpi: Kpi; t: (k: string) => string }) {
  return (
    <article className="gx-adm-kpi">
      <span className="gx-adm-kpi__label">{t(kpi.label)}</span>
      <span className="gx-adm-kpi__value">{kpi.value}</span>
    </article>
  );
}

export function Uso() {
  const { t, service } = useAdmin();
  const data = service.getUso();
  const maxTokens = Math.max(...data.tokensPorAgente.map((r) => r.tokens30d), 1);

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('uso.title')}</h1>
        <p className="gx-adm-sub">{t('uso.subtitle')}</p>
      </header>

      <div className="gx-adm-kpirow">
        {data.kpis.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} t={t} />
        ))}
      </div>

      {/* Minutos de runner por destino */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('uso.minutos_title')}</span>
        <ul className="gx-adm-uso-dest">
          {data.minutosPorDestino.map((m) => {
            const key = DESTINO_KEY[m.destino];
            const label = key ? t(key) : m.destino;
            return (
              <li key={m.destino} data-ext={m.externo ? 'true' : undefined}>
                <div className="gx-adm-uso-desthead">
                  <span className="gx-adm-uso-destname">
                    {label}
                    {m.externo ? ` — ${t('common.externo')}` : ''}
                  </span>
                  {!m.externo && <span className="gx-adm-uso-destpct">{m.pct}%</span>}
                  {!m.externo && <span className="gx-adm-uso-destmin">{fmtNum(m.minutos)} min</span>}
                </div>
                {m.externo ? (
                  <div className="gx-adm-uso-dotted" aria-hidden="true" />
                ) : (
                  <div className="gx-adm-meter" aria-hidden="true">
                    <span className="gx-adm-meter__fill" style={{ width: `${m.pct}%`, background: m.color }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Tokens por agente */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('uso.tokens_title')}</span>
        <ul className="gx-adm-uso-tok">
          {data.tokensPorAgente.map((r) => (
            <li key={r.agente}>
              <span className="gx-adm-dot" style={{ background: r.color }} />
              <span className="gx-adm-uso-tokname">
                <span className="gx-adm-uso-tokalias">{r.agente}</span>
                <span className="gx-adm-uso-tokesp">{t(r.especialidad)}</span>
              </span>
              <span className="gx-adm-meter" aria-hidden="true">
                <span className="gx-adm-meter__fill" style={{ width: pctWidth(r.tokens30d, maxTokens), background: r.color }} />
              </span>
              <span className="gx-adm-uso-toktokens">{r.tokens30d}M</span>
              <span className="gx-adm-uso-tokcost">{fmtUsd(r.costoUsd)}</span>
            </li>
          ))}
          <li className="gx-adm-uso-tok gx-adm-uso-toktotal">
            <span />
            <span className="gx-adm-uso-tokalias">{t('uso.tokens_total')}</span>
            <span />
            <span className="gx-adm-uso-toktokens">{data.tokensTotal}M</span>
            <span className="gx-adm-uso-tokcost">{fmtUsd(data.costoTotal)}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
