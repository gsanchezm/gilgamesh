// salud view copy (Group B). Prefix "salud." — pre-registered in i18n/index.ts. es/en authored
// key-for-key (parity test). Incident titles + status labels live in common.ts (read-only), reused.
import type { ViewDict } from './dict';

const salud: ViewDict = {
  es: {
    'salud.title': 'Salud del sistema',
    'salud.subtitle': 'Runners, incidentes y estado del motor TOM / Atomic-Helix.',
    'salud.kpi_uptime': 'Uptime 30d',
    'salud.kpi_incidentes': 'Incidentes abiertos',
    'salud.kpi_cola': 'Cola',
    'salud.kpi_motor': 'Motor',
    'salud.pools_title': 'Pools de runners',
    'salud.workers': 'workers activos',
    'salud.uptime_title': 'Uptime · últimos 30 días',
    'salud.uptime_ok': 'operativo',
    'salud.uptime_degradado': 'degradado',
    'salud.inc_title': 'Incidentes',
    'salud.inc_resolved_in': 'resuelto en',
  },
  en: {
    'salud.title': 'System health',
    'salud.subtitle': 'Runners, incidents and TOM / Atomic-Helix engine status.',
    'salud.kpi_uptime': 'Uptime 30d',
    'salud.kpi_incidentes': 'Open incidents',
    'salud.kpi_cola': 'Queue',
    'salud.kpi_motor': 'Engine',
    'salud.pools_title': 'Runner pools',
    'salud.workers': 'active workers',
    'salud.uptime_title': 'Uptime · last 30 days',
    'salud.uptime_ok': 'operational',
    'salud.uptime_degradado': 'degraded',
    'salud.inc_title': 'Incidents',
    'salud.inc_resolved_in': 'resolved in',
  },
};

export default salud;
