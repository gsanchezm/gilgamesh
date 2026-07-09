// Workspace · Facturación (README §5 — the customer's OWN billing: plan, method, own invoices).
// This is the workspace's own billing, NOT an internal Gilgamesh cost. Prefix "wsf.".
import type { ViewDict } from './dict';

const wsFacturacion: ViewDict = {
  es: {
    'wsf.title': 'Facturación',
    'wsf.subtitle': 'Plan, método de pago y facturas.',
    'wsf.hero_renueva': 'Renueva',
    'wsf.manage_plan': 'Gestionar plan',
    'wsf.manage_toast': 'Abriendo la gestión del plan…',
    'wsf.method_title': 'Método de pago',
    'wsf.method_update': 'Actualizar',
    'wsf.method_toast': 'Actualizar método de pago…',
    'wsf.next_title': 'Próximo cargo',
    'wsf.next_sub': 'Se cobrará a tu método de pago.',
    'wsf.invoices_title': 'Tus facturas',
    'wsf.col_fecha': 'Fecha',
    'wsf.col_folio': 'Folio',
    'wsf.col_monto': 'Monto',
    'wsf.col_estado': 'Estado',
    'wsf.download': 'Descargar',
    'wsf.download_toast': 'Descargando factura…',
    'wsf.fe_pagada': 'Pagada',
    'wsf.fe_pendiente': 'Pendiente',
    'wsf.fe_vencida': 'Vencida',
  },
  en: {
    'wsf.title': 'Billing',
    'wsf.subtitle': 'Plan, payment method and invoices.',
    'wsf.hero_renueva': 'Renews',
    'wsf.manage_plan': 'Manage plan',
    'wsf.manage_toast': 'Opening plan management…',
    'wsf.method_title': 'Payment method',
    'wsf.method_update': 'Update',
    'wsf.method_toast': 'Update payment method…',
    'wsf.next_title': 'Next charge',
    'wsf.next_sub': 'Will be charged to your payment method.',
    'wsf.invoices_title': 'Your invoices',
    'wsf.col_fecha': 'Date',
    'wsf.col_folio': 'Invoice #',
    'wsf.col_monto': 'Amount',
    'wsf.col_estado': 'Status',
    'wsf.download': 'Download',
    'wsf.download_toast': 'Downloading invoice…',
    'wsf.fe_pagada': 'Paid',
    'wsf.fe_pendiente': 'Pending',
    'wsf.fe_vencida': 'Overdue',
  },
};

export default wsFacturacion;
