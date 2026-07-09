// Workspace · Proyectos (README §5 — scoped, NO client column, NO cost column). Prefix "wsp.".
import type { ViewDict } from './dict';

const wsProyectos: ViewDict = {
  es: {
    'wsp.title': 'Proyectos',
    'wsp.subtitle': 'Los proyectos de tu workspace.',
    'wsp.col_proyecto': 'Proyecto',
    'wsp.col_formato': 'Formato',
    'wsp.col_agentes': 'Agentes',
    'wsp.col_runs': 'Runs 30d',
    'wsp.col_exito': 'Éxito',
    'wsp.col_ultima': 'Última ejecución',
    'wsp.empty': 'Aún no hay proyectos en este workspace.',
  },
  en: {
    'wsp.title': 'Projects',
    'wsp.subtitle': 'Your workspace projects.',
    'wsp.col_proyecto': 'Project',
    'wsp.col_formato': 'Format',
    'wsp.col_agentes': 'Agents',
    'wsp.col_runs': 'Runs 30d',
    'wsp.col_exito': 'Success',
    'wsp.col_ultima': 'Last run',
    'wsp.empty': 'No projects in this workspace yet.',
  },
};

export default wsProyectos;
