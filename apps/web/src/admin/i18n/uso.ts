// uso view copy (Group B). Prefix "uso." — pre-registered in i18n/index.ts. es/en authored key-for-key
// (parity test). Target labels (destino.*) live in common.ts (read-only) and are reused for EN parity.
import type { ViewDict } from './dict';

const uso: ViewDict = {
  es: {
    'uso.title': 'Uso de agentes y runners',
    'uso.subtitle': 'Minutos de runner por destino y tokens consumidos por cada agente.',
    'uso.kpi_min': 'Minutos · 30 días',
    'uso.kpi_sesiones': 'Sesiones grabadas',
    'uso.kpi_artefactos': 'Artefactos',
    'uso.kpi_cola': 'Cola',
    'uso.minutos_title': 'Minutos de runner por destino',
    'uso.tokens_title': 'Tokens por agente',
    'uso.tokens_total': 'Total',
  },
  en: {
    'uso.title': 'Agent & runner usage',
    'uso.subtitle': 'Runner minutes by target and tokens consumed by each agent.',
    'uso.kpi_min': 'Minutes · 30 days',
    'uso.kpi_sesiones': 'Recorded sessions',
    'uso.kpi_artefactos': 'Artifacts',
    'uso.kpi_cola': 'Queue',
    'uso.minutos_title': 'Runner minutes by target',
    'uso.tokens_title': 'Tokens per agent',
    'uso.tokens_total': 'Total',
  },
};

export default uso;
