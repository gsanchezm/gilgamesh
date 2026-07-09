// proyectoDetalle view copy (Group A). Prefix "pd." — pre-registered in i18n/index.ts.
import type { ViewDict } from './dict';

const proyectoDetalle: ViewDict = {
  es: {
    'pd.title': 'Detalle de proyecto',
    'pd.subtitle': 'Ejecuciones, destinos por disciplina y costo.',
    'pd.back': 'Proyectos',
    'pd.notfound': 'Proyecto no encontrado.',
    'pd.cliente': 'Cliente',
    // KPIs
    'pd.kpi_runs': 'Runs 30d',
    'pd.kpi_exito': 'Éxito',
    'pd.kpi_costo': 'Costo 30d',
    'pd.kpi_ultima': 'Última ejecución',
    // Per-discipline target notes
    'pd.target_web': 'Chromium / Firefox · Safari·iOS vía runner externo',
    'pd.target_android': 'Emulador Android (Pixel 8 · API 34)',
    'pd.target_api': 'Cliente HTTP del motor',
    // Assigned agents
    'pd.agentes_title': 'Agentes asignados',
    // Runs table
    'pd.ejec_title': 'Últimas ejecuciones',
    'pd.ej_run': 'Ejecución',
    'pd.ej_fecha': 'Fecha',
    'pd.ej_destino': 'Destino',
    'pd.ej_escenarios': 'Escenarios',
    'pd.ej_resultado': 'Resultado',
    'pd.ej_duracion': 'Duración',
    'pd.ej_costo': 'Costo',
    'pd.ej_sesion': 'Sesión',
    'pd.ver_sesion': 'Ver sesión',
    'pd.toast_sesion': 'Reproducción de sesión (demo).',
    'pd.ejec_empty': 'Sin ejecuciones registradas en el periodo.',
    // Cost breakdown
    'pd.costo_title': 'Costo · 30 días',
    'pd.costo_runner': 'Minutos de runner',
    'pd.costo_tokens': 'Tokens LLM',
    'pd.costo_storage': 'Almacenamiento',
  },
  en: {
    'pd.title': 'Project detail',
    'pd.subtitle': 'Runs, per-discipline targets and cost.',
    'pd.back': 'Projects',
    'pd.notfound': 'Project not found.',
    'pd.cliente': 'Client',
    // KPIs
    'pd.kpi_runs': 'Runs 30d',
    'pd.kpi_exito': 'Success',
    'pd.kpi_costo': 'Cost 30d',
    'pd.kpi_ultima': 'Last run',
    // Per-discipline target notes
    'pd.target_web': 'Chromium / Firefox · Safari·iOS via external runner',
    'pd.target_android': 'Android emulator (Pixel 8 · API 34)',
    'pd.target_api': 'Engine HTTP client',
    // Assigned agents
    'pd.agentes_title': 'Assigned agents',
    // Runs table
    'pd.ejec_title': 'Latest runs',
    'pd.ej_run': 'Run',
    'pd.ej_fecha': 'Date',
    'pd.ej_destino': 'Target',
    'pd.ej_escenarios': 'Scenarios',
    'pd.ej_resultado': 'Result',
    'pd.ej_duracion': 'Duration',
    'pd.ej_costo': 'Cost',
    'pd.ej_sesion': 'Session',
    'pd.ver_sesion': 'View session',
    'pd.toast_sesion': 'Session replay (demo).',
    'pd.ejec_empty': 'No runs recorded in the period.',
    // Cost breakdown
    'pd.costo_title': 'Cost · 30 days',
    'pd.costo_runner': 'Runner minutes',
    'pd.costo_tokens': 'LLM tokens',
    'pd.costo_storage': 'Storage',
  },
};

export default proyectoDetalle;
