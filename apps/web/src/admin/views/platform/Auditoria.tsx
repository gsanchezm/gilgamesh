import { useMemo, useState, type CSSProperties } from 'react';
import { useAdmin } from '../../AdminContext';
import { CATEGORIA_COLOR } from '../../data/mock';
import type { CategoriaAuditoria } from '../../data/types';
import './Auditoria.css';

type Filtro = CategoriaAuditoria | 'all';

// Filter order (README-admin §4.11): Todo / Acceso / Facturación / Configuración / Ejecuciones / Seguridad.
const FILTROS: { key: Filtro; label: string }[] = [
  { key: 'all', label: 'auditoria.filter_all' },
  { key: 'auth', label: 'categoria.auth' },
  { key: 'bill', label: 'categoria.bill' },
  { key: 'cfg', label: 'categoria.cfg' },
  { key: 'runs', label: 'categoria.runs' },
  { key: 'sec', label: 'categoria.sec' },
];

export function Auditoria() {
  const { t, service } = useAdmin();
  const entries = service.getAuditoria();
  const [filtro, setFiltro] = useState<Filtro>('all');

  // In-memory narrowing (no reload) — the whole point of §4.11's chip filters.
  const rows = useMemo(
    () => (filtro === 'all' ? entries : entries.filter((e) => e.categoria === filtro)),
    [entries, filtro],
  );

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('auditoria.title')}</h1>
        <p className="gx-adm-sub">{t('auditoria.subtitle')}</p>
      </header>

      <div className="gx-adm-audit__filters" role="group" aria-label={t('auditoria.title')}>
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="gx-adm-audit__chip"
            data-active={filtro === f.key}
            onClick={() => setFiltro(f.key)}
          >
            {t(f.label)}
          </button>
        ))}
      </div>

      <section className="gx-adm-card">
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-adm-audit__table">
            <thead>
              <tr>
                <th>{t('auditoria.col_hora')}</th>
                <th>{t('auditoria.col_categoria')}</th>
                <th>{t('auditoria.col_accion')}</th>
                <th>{t('auditoria.col_objetivo')}</th>
                <th>{t('auditoria.col_actor')}</th>
                <th>{t('auditoria.col_ip')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.ts}-${i}`}>
                  <td className="gx-adm-mono gx-adm-audit__ts">{e.ts}</td>
                  <td>
                    <span
                      className="gx-adm-chip gx-adm-chip--cat"
                      style={{ '--chip': CATEGORIA_COLOR[e.categoria] } as CSSProperties}
                    >
                      {t(`categoria.${e.categoria}`)}
                    </span>
                  </td>
                  <td className="gx-adm-audit__accion">{t(e.accion)}</td>
                  <td className="gx-adm-audit__objetivo">{e.objetivo}</td>
                  <td className="gx-adm-audit__actor">{e.actor}</td>
                  <td className="gx-adm-mono gx-adm-audit__ip">{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
