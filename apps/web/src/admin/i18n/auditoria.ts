// auditoria view copy (Group C). Pre-registered in i18n/index.ts (prefix "auditoria."); no shared file
// needs editing. Category labels are read from `common.ts` (categoria.*), not duplicated here.
import type { ViewDict } from './dict';

const auditoria: ViewDict = {
  es: {
    'auditoria.title': 'Auditoría',
    'auditoria.subtitle': 'Registro de acceso, facturación, configuración y seguridad.',
    'auditoria.filter_all': 'Todo',
    'auditoria.col_hora': 'Hora',
    'auditoria.col_categoria': 'Categoría',
    'auditoria.col_accion': 'Acción',
    'auditoria.col_objetivo': 'Objetivo',
    'auditoria.col_actor': 'Actor',
    'auditoria.col_ip': 'IP',
  },
  en: {
    'auditoria.title': 'Audit',
    'auditoria.subtitle': 'Access, billing, config and security event log.',
    'auditoria.filter_all': 'All',
    'auditoria.col_hora': 'Time',
    'auditoria.col_categoria': 'Category',
    'auditoria.col_accion': 'Action',
    'auditoria.col_objetivo': 'Target',
    'auditoria.col_actor': 'Actor',
    'auditoria.col_ip': 'IP',
  },
};

export default auditoria;
