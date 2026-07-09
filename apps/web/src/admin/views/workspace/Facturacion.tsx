import { useAdmin } from '../../AdminContext';
import type { EstadoFactura } from '../../data/types';
import { fmtDate, fmtUsd } from '../../util';
import './workspace.css';

// This is the customer's OWN billing (their plan price + their own invoice amounts) — the workspace's
// billing, NOT an internal Gilgamesh cost. No token/minute cost or margin appears anywhere here.

/** Invoice status → dot colour (README §4.2: green / amber / red). */
const FACTURA_COLOR: Record<EstadoFactura, string> = {
  pagada: '#3FB07A',
  pendiente: '#C08A2E',
  vencida: '#E0738A',
};

export function Facturacion() {
  const { t, lang, service, wsId, showToast } = useAdmin();
  const data = service.getWorkspaceFacturacion(wsId);

  if (!data) {
    return (
      <div className="gx-adm-page">
        <header className="gx-adm-pagehead">
          <h1 className="gx-adm-title">{t('wsf.title')}</h1>
          <p className="gx-adm-sub">{t('wsf.subtitle')}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="gx-adm-page">
      <header className="gx-adm-pagehead">
        <h1 className="gx-adm-title">{t('wsf.title')}</h1>
        <p className="gx-adm-sub">{t('wsf.subtitle')}</p>
      </header>

      {/* Plan hero (navy) */}
      <section className="gx-adm-card gx-adm-hero gx-ws-billhero">
        <div className="gx-ws-billhero__info">
          <div className="gx-ws-billhero__plan">
            <span className="gx-ws-billhero__planname">{t(`plan.${data.plan}`)}</span>
          </div>
          <span className="gx-ws-billhero__price">
            {fmtUsd(data.precioMensualUsd)}
            <small> {t('common.mo')}</small>
          </span>
          <span className="gx-ws-billhero__renew">
            {t('wsf.hero_renueva')} {fmtDate(lang, data.renueva)}
          </span>
        </div>
        <button type="button" className="gx-ws-btn-gold" onClick={() => showToast(t('wsf.manage_toast'))}>
          {t('wsf.manage_plan')}
        </button>
      </section>

      <div className="gx-adm-grid2">
        {/* Payment method */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('wsf.method_title')}</span>
          <div className="gx-ws-payrow">
            <span className="gx-ws-payrow__brand">{data.metodoPago}</span>
            <button type="button" className="gx-ws-btn-ghost" onClick={() => showToast(t('wsf.method_toast'))}>
              {t('wsf.method_update')}
            </button>
          </div>
        </section>

        {/* Next charge */}
        <section className="gx-adm-card">
          <span className="gx-adm-eyebrow">{t('wsf.next_title')}</span>
          <div className="gx-ws-next">
            <span className="gx-ws-next__amount">
              {fmtUsd(data.proximoCargo.montoUsd)} · {fmtDate(lang, data.proximoCargo.fecha)}
            </span>
            <span className="gx-ws-next__sub">{t('wsf.next_sub')}</span>
          </div>
        </section>
      </div>

      {/* Own invoices */}
      <section className="gx-adm-card">
        <span className="gx-adm-eyebrow">{t('wsf.invoices_title')}</span>
        <div className="gx-adm-tablewrap">
          <table className="gx-adm-table gx-ws-table">
            <thead>
              <tr>
                <th>{t('wsf.col_fecha')}</th>
                <th>{t('wsf.col_folio')}</th>
                <th>{t('wsf.col_monto')}</th>
                <th>{t('wsf.col_estado')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.facturas.map((f) => (
                <tr key={f.folio}>
                  <td className="gx-ws-mono">{fmtDate(lang, f.fecha)}</td>
                  <td className="gx-ws-mono">{f.folio}</td>
                  <td className="gx-ws-mono">{fmtUsd(f.montoUsd)}</td>
                  <td>
                    <span className="gx-adm-status">
                      <span className="gx-adm-status__dot" style={{ background: FACTURA_COLOR[f.estado] }} />
                      {t(`wsf.fe_${f.estado}`)}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="gx-ws-linkbtn" onClick={() => showToast(t('wsf.download_toast'))}>
                      {t('wsf.download')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
