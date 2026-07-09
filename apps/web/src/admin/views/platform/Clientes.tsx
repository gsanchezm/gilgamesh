import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdmin } from '../../AdminContext';
import { ESTADO_COLOR, PLAN_COLOR } from '../../data/mock';
import type { ClienteRow, Lang } from '../../data/types';
import { fmtDate, fmtUsd, pctWidth } from '../../util';
import './Clientes.css';

/** Cycle-usage bar: green, amber when over 85% of the cycle (README §4.3). */
const USO_AMBER = '#C08A2E';
const USO_GREEN = '#3FB07A';

function ClienteRowView({ c, onOpen, t, lang }: { c: ClienteRow; onOpen: () => void; t: (k: string) => string; lang: Lang }) {
  const usoColor = c.usoPct > 85 ? USO_AMBER : USO_GREEN;
  return (
    <tr
      className="gx-adm-cli__row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      data-testid={`cli-row-${c.id}`}
    >
      <td>
        <div className="gx-adm-cli__client">
          <span className="gx-adm-chip" style={{ background: c.color }}>
            {c.abbr}
          </span>
          <span className="gx-adm-cli__ctext">
            <span className="gx-adm-cli__name">{c.nombre}</span>
            <span className="gx-adm-cli__domain">{c.dominio}</span>
          </span>
        </div>
      </td>
      <td>
        <span className="gx-adm-chip gx-adm-chip--plan" style={{ '--chip': PLAN_COLOR[c.plan] } as CSSProperties}>
          {t(`plan.${c.plan}`)}
        </span>
      </td>
      <td className="gx-adm-mono">
        {c.seats} / {c.seatsMax}
      </td>
      <td className="gx-adm-mono">{fmtUsd(c.mrr)}</td>
      <td>
        <div className="gx-adm-cli__uso">
          <span className="gx-adm-meter gx-adm-cli__usobar" aria-hidden="true">
            <span className="gx-adm-meter__fill" style={{ width: pctWidth(c.usoPct, 100), background: usoColor }} />
          </span>
          <span className="gx-adm-cli__usopct">{c.usoPct}%</span>
        </div>
      </td>
      <td>
        <span className="gx-adm-status" style={{ color: ESTADO_COLOR[c.estado] }}>
          <span className="gx-adm-status__dot" style={{ background: ESTADO_COLOR[c.estado] }} />
          {t(`estado.${c.estado}`)}
        </span>
      </td>
      <td className="gx-adm-mono gx-adm-cli__desde">{fmtDate(lang, c.clienteDesde)}</td>
    </tr>
  );
}

export function Clientes() {
  const { t, lang, service, setSelClient } = useAdmin();
  const navigate = useNavigate();
  const rows = service.getClientes();

  const open = (id: string) => {
    setSelClient(id);
    navigate(`/admin/clientes/${id}`);
  };

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('clientes.title')}</h1>
        <p className="gx-adm-sub">{t('clientes.subtitle')}</p>
      </header>

      <section className="gx-adm-card">
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table">
            <thead>
              <tr>
                <th>{t('clientes.h_cliente')}</th>
                <th>{t('clientes.h_plan')}</th>
                <th>{t('clientes.h_seats')}</th>
                <th>{t('clientes.h_mrr')}</th>
                <th>{t('clientes.h_uso')}</th>
                <th>{t('clientes.h_estado')}</th>
                <th>{t('clientes.h_desde')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <ClienteRowView key={c.id} c={c} t={t} lang={lang} onOpen={() => open(c.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
