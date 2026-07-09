// Admin console — ALL mock data (README-admin §4 platform + §5 workspace), with the exact figures
// the spec pins. Currency USD. This is the single source the `MockAdminService` reads; a real API
// drops in behind the same `AdminService` interface later. Read-only for Phase 2.
//
// Relative timestamps are stored as compact codes ('2h', '1d', '30min') and rendered bilingually by
// `relTime()` (util.ts). Translatable row text (audit actions, plan/estado/role labels) is stored as
// i18n KEYS and resolved through T() in the views — so the data stays language-neutral and §7-faithful.

import type {
  Auditoria,
  Cliente,
  Ejecucion,
  Factura,
  Incidente,
  PlanPricing,
  Pool,
  Proyecto,
  TokensAgente,
} from './types';

// Discipline family colours (README §4.2) — the token/pill dots.
const FAM = {
  proceso: '#A07D2C',
  ui: '#3F6FA3',
  backend: '#7E63A6',
  guardian: '#2F8F78',
} as const;

/** Estado → colour (README §4.3). */
export const ESTADO_COLOR: Record<string, string> = {
  activo: '#3FB07A',
  trial: '#43B7E8',
  moroso: '#E0738A',
  riesgo: '#C08A2E',
  suspendido: '#9AA0AC',
};

/** Plan chip colour (README §4.3). */
export const PLAN_COLOR: Record<string, string> = {
  enterprise: '#C9A14E',
  business: '#3F6FA3',
  team: '#7E63A6',
  trial: '#43B7E8',
};

/** Audit category chip colour (README §4.11). */
export const CATEGORIA_COLOR: Record<string, string> = {
  auth: '#43B7E8',
  bill: '#C08A2E',
  cfg: '#7E63A6',
  runs: '#2F8F78',
  sec: '#E0738A',
};

/** Discipline colour by agent id (used for token/agent dots). */
export const AGENTE_COLOR: Record<string, string> = {
  lead: FAM.proceso,
  arch: FAM.proceso,
  manual: FAM.proceso,
  web: FAM.ui,
  api: FAM.backend,
  android: FAM.ui,
  ios: FAM.ui,
  perf: FAM.backend,
  visual: FAM.ui,
  sec: FAM.guardian,
  a11y: FAM.guardian,
};

// ---------------------------------------------------------------------------------------------
// Clientes (workspaces) — 10 accounts. Paying MRR sums to $8,744 (3 Enterprise $6,450 + 4 Business
// $1,996 + 2 Team $298); Zephyr is a non-paying trial → 9 active / 10 total, 1 trial, 1 moroso.
// ---------------------------------------------------------------------------------------------
export const CLIENTES: Cliente[] = [
  {
    id: 'omnipizza',
    nombre: 'OmniPizza Inc',
    dominio: 'omnipizza.com',
    abbr: 'OP',
    color: '#C9A14E',
    plan: 'business',
    mrr: 499,
    seats: 14,
    seatsMax: 20,
    ejecuciones: 3420,
    ejecucionesMax: 5000,
    agentHours: 86,
    agentHoursMax: 120,
    vozMin: 240,
    vozMinMax: 500,
    estado: 'activo',
    clienteDesde: '2025-03-12',
    contacto: 'ops@omnipizza.com',
  },
  {
    id: 'vectorbank',
    nombre: 'Vector Bank',
    dominio: 'vectorbank.io',
    abbr: 'VB',
    color: '#3F6FA3',
    plan: 'enterprise',
    mrr: 2400,
    seats: 46,
    seatsMax: 60,
    ejecuciones: 18600,
    ejecucionesMax: 25000,
    agentHours: 412,
    agentHoursMax: 600,
    vozMin: 1240,
    vozMinMax: 2500,
    estado: 'activo',
    clienteDesde: '2024-08-02',
    contacto: 'qa@vectorbank.io',
  },
  {
    id: 'tolteca',
    nombre: 'Tolteca Gaming',
    dominio: 'tolteca.gg',
    abbr: 'TG',
    color: '#7E63A6',
    plan: 'enterprise',
    mrr: 2150,
    seats: 27,
    seatsMax: 50,
    ejecuciones: 12300,
    ejecucionesMax: 20000,
    agentHours: 286,
    agentHoursMax: 500,
    vozMin: 820,
    vozMinMax: 2000,
    estado: 'activo',
    clienteDesde: '2024-11-19',
    contacto: 'devqa@tolteca.gg',
  },
  {
    id: 'aurora',
    nombre: 'Aurora Health',
    dominio: 'aurorahealth.co',
    abbr: 'AH',
    color: '#2F8F78',
    plan: 'enterprise',
    mrr: 1900,
    seats: 31,
    seatsMax: 50,
    ejecuciones: 16400,
    ejecucionesMax: 20000,
    agentHours: 398,
    agentHoursMax: 500,
    vozMin: 640,
    vozMinMax: 2000,
    estado: 'activo',
    clienteDesde: '2025-01-08',
    contacto: 'quality@aurorahealth.co',
  },
  {
    id: 'kappa',
    nombre: 'Kappa Logistics',
    dominio: 'kappalog.io',
    abbr: 'KL',
    color: '#E0738A',
    plan: 'business',
    mrr: 499,
    seats: 12,
    seatsMax: 20,
    ejecuciones: 2200,
    ejecucionesMax: 5000,
    agentHours: 52,
    agentHoursMax: 120,
    vozMin: 90,
    vozMinMax: 500,
    estado: 'moroso',
    clienteDesde: '2025-02-21',
    contacto: 'it@kappalog.io',
  },
  {
    id: 'nimbus',
    nombre: 'Nimbus Retail',
    dominio: 'nimbusretail.com',
    abbr: 'NR',
    color: '#43B7E8',
    plan: 'business',
    mrr: 499,
    seats: 9,
    seatsMax: 20,
    ejecuciones: 2900,
    ejecucionesMax: 5000,
    agentHours: 68,
    agentHoursMax: 120,
    vozMin: 160,
    vozMinMax: 500,
    estado: 'activo',
    clienteDesde: '2025-04-03',
    contacto: 'marco@nimbusretail.com',
  },
  {
    id: 'helios',
    nombre: 'Helios Energy',
    dominio: 'helios-energy.com',
    abbr: 'HE',
    color: '#C08A2E',
    plan: 'business',
    mrr: 499,
    seats: 6,
    seatsMax: 20,
    ejecuciones: 4550,
    ejecucionesMax: 5000,
    agentHours: 109,
    agentHoursMax: 120,
    vozMin: 430,
    vozMinMax: 500,
    estado: 'riesgo',
    clienteDesde: '2025-05-16',
    contacto: 'ops@helios-energy.com',
  },
  {
    id: 'meridian',
    nombre: 'Meridian Labs',
    dominio: 'meridianlabs.dev',
    abbr: 'ML',
    color: '#A07D2C',
    plan: 'team',
    mrr: 149,
    seats: 4,
    seatsMax: 5,
    ejecuciones: 990,
    ejecucionesMax: 1500,
    agentHours: 24,
    agentHoursMax: 40,
    vozMin: 40,
    vozMinMax: 150,
    estado: 'activo',
    clienteDesde: '2025-06-01',
    contacto: 'hello@meridianlabs.dev',
  },
  {
    id: 'cobalt',
    nombre: 'Cobalt Studio',
    dominio: 'cobalt.studio',
    abbr: 'CS',
    color: '#6C8CBF',
    plan: 'team',
    mrr: 149,
    seats: 3,
    seatsMax: 5,
    ejecuciones: 580,
    ejecucionesMax: 1500,
    agentHours: 14,
    agentHoursMax: 40,
    vozMin: 20,
    vozMinMax: 150,
    estado: 'activo',
    clienteDesde: '2025-06-20',
    contacto: 'team@cobalt.studio',
  },
  {
    id: 'zephyr',
    nombre: 'Zephyr Foods',
    dominio: 'zephyrfoods.com',
    abbr: 'ZF',
    color: '#9AA0AC',
    plan: 'trial',
    mrr: 0,
    seats: 2,
    seatsMax: 5,
    ejecuciones: 330,
    ejecucionesMax: 1500,
    agentHours: 7,
    agentHoursMax: 40,
    vozMin: 0,
    vozMinMax: 150,
    estado: 'trial',
    clienteDesde: '2026-06-28',
    contacto: 'founder@zephyrfoods.com',
  },
];

/** Cycle-usage % per client (README §4.3: >85% renders amber). */
export const USO_PCT: Record<string, number> = {
  omnipizza: 68,
  vectorbank: 74,
  tolteca: 61,
  aurora: 82,
  kappa: 44,
  nimbus: 58,
  helios: 91,
  meridian: 66,
  cobalt: 39,
  zephyr: 22,
};

// ---------------------------------------------------------------------------------------------
// Proyectos — 10 cross-tenant (README §4.6). `costo30d` is PLATFORM-ONLY.
// ---------------------------------------------------------------------------------------------
export const PROYECTOS: Proyecto[] = [
  { id: 'p-omni-checkout', clienteId: 'omnipizza', nombre: 'Checkout Web', formato: 'bdd', tipo: 'web', agentes: ['web', 'visual', 'a11y'], runs30d: 128, exitoPct: 96, costo30d: 84, ultimaEjecucion: '2h' },
  { id: 'p-omni-mobile', clienteId: 'omnipizza', nombre: 'App Android', formato: 'bdd', tipo: 'android', agentes: ['android', 'visual'], runs30d: 74, exitoPct: 92, costo30d: 61, ultimaEjecucion: '5h' },
  { id: 'p-vector-api', clienteId: 'vectorbank', nombre: 'Core Banking API', formato: 'cases', tipo: 'api', agentes: ['api', 'sec', 'perf'], runs30d: 212, exitoPct: 98, costo30d: 190, ultimaEjecucion: '1h' },
  { id: 'p-vector-web', clienteId: 'vectorbank', nombre: 'Banca Web', formato: 'bdd', tipo: 'web', agentes: ['web', 'sec', 'a11y'], runs30d: 156, exitoPct: 94, costo30d: 142, ultimaEjecucion: '3h' },
  { id: 'p-tolteca-web', clienteId: 'tolteca', nombre: 'Portal de Jugadores', formato: 'bdd', tipo: 'web', agentes: ['web', 'perf', 'visual'], runs30d: 98, exitoPct: 90, costo30d: 118, ultimaEjecucion: '8h' },
  { id: 'p-aurora-api', clienteId: 'aurora', nombre: 'FHIR API', formato: 'cases', tipo: 'api', agentes: ['api', 'sec'], runs30d: 143, exitoPct: 97, costo30d: 132, ultimaEjecucion: '4h' },
  { id: 'p-aurora-web', clienteId: 'aurora', nombre: 'Portal del Paciente', formato: 'bdd', tipo: 'web', agentes: ['web', 'a11y'], runs30d: 88, exitoPct: 93, costo30d: 96, ultimaEjecucion: '6h' },
  { id: 'p-kappa-web', clienteId: 'kappa', nombre: 'Rastreo de Envíos', formato: 'bdd', tipo: 'web', agentes: ['web'], runs30d: 41, exitoPct: 88, costo30d: 38, ultimaEjecucion: '1d' },
  { id: 'p-nimbus-android', clienteId: 'nimbus', nombre: 'App de Compras', formato: 'bdd', tipo: 'android', agentes: ['android', 'visual'], runs30d: 63, exitoPct: 91, costo30d: 54, ultimaEjecucion: '12h' },
  { id: 'p-helios-api', clienteId: 'helios', nombre: 'Telemetría', formato: 'cases', tipo: 'api', agentes: ['api', 'perf'], runs30d: 77, exitoPct: 89, costo30d: 71, ultimaEjecucion: '9h' },
];

// ---------------------------------------------------------------------------------------------
// Facturas — pending sums to $648 (Nimbus $499 + Cobalt $149 = por cobrar); Kappa $499 overdue.
// ---------------------------------------------------------------------------------------------
export const FACTURAS: Factura[] = [
  { fecha: '2026-07-01', folio: 'INV-2026-07-001', clienteId: 'vectorbank', montoUsd: 2400, estado: 'pagada' },
  { fecha: '2026-07-01', folio: 'INV-2026-07-002', clienteId: 'tolteca', montoUsd: 2150, estado: 'pagada' },
  { fecha: '2026-07-01', folio: 'INV-2026-07-003', clienteId: 'aurora', montoUsd: 1900, estado: 'pagada' },
  { fecha: '2026-07-01', folio: 'INV-2026-07-004', clienteId: 'omnipizza', montoUsd: 499, estado: 'pagada' },
  { fecha: '2026-07-03', folio: 'INV-2026-07-005', clienteId: 'nimbus', montoUsd: 499, estado: 'pendiente' },
  { fecha: '2026-06-15', folio: 'INV-2026-07-006', clienteId: 'kappa', montoUsd: 499, estado: 'vencida' },
  { fecha: '2026-07-01', folio: 'INV-2026-07-007', clienteId: 'helios', montoUsd: 499, estado: 'pagada' },
  { fecha: '2026-07-01', folio: 'INV-2026-07-008', clienteId: 'meridian', montoUsd: 149, estado: 'pagada' },
  { fecha: '2026-07-04', folio: 'INV-2026-07-009', clienteId: 'cobalt', montoUsd: 149, estado: 'pendiente' },
];

// Workspace-scoped invoices for OmniPizza (facturación view).
export const FACTURAS_WS: Record<string, Factura[]> = {
  omnipizza: [
    { fecha: '2026-07-01', folio: 'INV-2026-07-004', clienteId: 'omnipizza', montoUsd: 499, estado: 'pagada' },
    { fecha: '2026-06-01', folio: 'INV-2026-06-004', clienteId: 'omnipizza', montoUsd: 499, estado: 'pagada' },
    { fecha: '2026-05-01', folio: 'INV-2026-05-004', clienteId: 'omnipizza', montoUsd: 499, estado: 'pagada' },
    { fecha: '2026-04-01', folio: 'INV-2026-04-004', clienteId: 'omnipizza', montoUsd: 499, estado: 'pagada' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Ejecuciones — recent runs keyed by project (README §4.7). `costoUsd` is PLATFORM-ONLY.
// ---------------------------------------------------------------------------------------------
export const EJECUCIONES: Ejecucion[] = [
  { id: 'RUN-4821', proyectoId: 'p-omni-checkout', fecha: '2h', destino: 'chromium', escenarios: 24, resultado: 'pass', duracion: '3m 12s', costoUsd: 2.1, sessionUrl: '#session/RUN-4821' },
  { id: 'RUN-4820', proyectoId: 'p-omni-checkout', fecha: '6h', destino: 'firefox', escenarios: 24, resultado: 'pass', duracion: '3m 40s', costoUsd: 2.3, sessionUrl: '#session/RUN-4820' },
  { id: 'RUN-4816', proyectoId: 'p-omni-checkout', fecha: '14h', destino: 'chromium', escenarios: 24, resultado: 'fail', duracion: '2m 58s', costoUsd: 1.9, sessionUrl: '#session/RUN-4816' },
  { id: 'RUN-4809', proyectoId: 'p-omni-checkout', fecha: '1d', destino: 'chromium', escenarios: 22, resultado: 'pass', duracion: '3m 05s', costoUsd: 2.0, sessionUrl: '#session/RUN-4809' },
  { id: 'RUN-4802', proyectoId: 'p-omni-mobile', fecha: '5h', destino: 'android-emu', escenarios: 18, resultado: 'pass', duracion: '5m 22s', costoUsd: 3.4, sessionUrl: '#session/RUN-4802' },
  { id: 'RUN-4795', proyectoId: 'p-omni-mobile', fecha: '1d', destino: 'android-emu', escenarios: 18, resultado: 'fail', duracion: '5m 03s', costoUsd: 3.1, sessionUrl: '#session/RUN-4795' },
  { id: 'RUN-4788', proyectoId: 'p-vector-api', fecha: '1h', destino: 'http', escenarios: 64, resultado: 'pass', duracion: '1m 48s', costoUsd: 1.2, sessionUrl: '#session/RUN-4788' },
  { id: 'RUN-4781', proyectoId: 'p-vector-web', fecha: '3h', destino: 'chromium', escenarios: 40, resultado: 'pass', duracion: '4m 30s', costoUsd: 2.8, sessionUrl: '#session/RUN-4781' },
];

// ---------------------------------------------------------------------------------------------
// Incidentes (README §4.9).
// ---------------------------------------------------------------------------------------------
export const INCIDENTES: Incidente[] = [
  { id: 'INC-214', titulo: 'inc.214', estado: 'monitoreando', inicio: '3h', duracion: '—' },
  { id: 'INC-213', titulo: 'inc.213', estado: 'resuelto', inicio: '2d', duracion: '42 min' },
  { id: 'INC-209', titulo: 'inc.209', estado: 'resuelto', inicio: '6d', duracion: '18 min' },
];

// ---------------------------------------------------------------------------------------------
// Tokens por agente — 11 deities (README §4.8). Quetzalcóatl first (142M / $318); total 486M / $1,240.
// ---------------------------------------------------------------------------------------------
export const TOKENS_AGENTE: TokensAgente[] = [
  { agente: 'Quetzalcóatl', especialidad: 'esp.web', tokens30d: 142, costoUsd: 318, color: FAM.ui, glifo: 'QC' },
  { agente: 'Athena', especialidad: 'esp.arch', tokens30d: 74, costoUsd: 200, color: FAM.proceso, glifo: 'AT' },
  { agente: 'Zeus', especialidad: 'esp.lead', tokens30d: 61, costoUsd: 170, color: FAM.proceso, glifo: 'ZE' },
  { agente: 'Freya', especialidad: 'esp.android', tokens30d: 46, costoUsd: 130, color: FAM.ui, glifo: 'FR' },
  { agente: 'Iris', especialidad: 'esp.api', tokens30d: 39, costoUsd: 103, color: FAM.backend, glifo: 'IR' },
  { agente: 'Xochiquetzal', especialidad: 'esp.visual', tokens30d: 33, costoUsd: 82, color: FAM.ui, glifo: 'XO' },
  { agente: 'Thor', especialidad: 'esp.perf', tokens30d: 27, costoUsd: 71, color: FAM.backend, glifo: 'TH' },
  { agente: 'Anubis', especialidad: 'esp.manual', tokens30d: 22, costoUsd: 55, color: FAM.proceso, glifo: 'AN' },
  { agente: 'Odin', especialidad: 'esp.sec', tokens30d: 18, costoUsd: 48, color: FAM.guardian, glifo: 'OD' },
  { agente: 'Ra', especialidad: 'esp.a11y', tokens30d: 14, costoUsd: 37, color: FAM.guardian, glifo: 'RA' },
  { agente: 'Isis', especialidad: 'esp.ios', tokens30d: 10, costoUsd: 26, color: FAM.ui, glifo: 'IS' },
];

// Workspace-scoped token usage for OmniPizza (cost stripped by the service).
export const TOKENS_AGENTE_WS: Record<string, TokensAgente[]> = {
  omnipizza: [
    { agente: 'Quetzalcóatl', especialidad: 'esp.web', tokens30d: 8.2, costoUsd: 0, color: FAM.ui, glifo: 'QC' },
    { agente: 'Athena', especialidad: 'esp.arch', tokens30d: 4.1, costoUsd: 0, color: FAM.proceso, glifo: 'AT' },
    { agente: 'Zeus', especialidad: 'esp.lead', tokens30d: 3.4, costoUsd: 0, color: FAM.proceso, glifo: 'ZE' },
    { agente: 'Freya', especialidad: 'esp.android', tokens30d: 2.6, costoUsd: 0, color: FAM.ui, glifo: 'FR' },
    { agente: 'Xochiquetzal', especialidad: 'esp.visual', tokens30d: 1.7, costoUsd: 0, color: FAM.ui, glifo: 'XO' },
    { agente: 'Ra', especialidad: 'esp.a11y', tokens30d: 1.1, costoUsd: 0, color: FAM.guardian, glifo: 'RA' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Runner pools + minutes-by-target (README §4.8 / §4.9). Total 72,500 runner minutes.
// ---------------------------------------------------------------------------------------------
export const POOLS: Pool[] = [
  { nombre: 'Chromium', workersOcupados: 6, workersTotal: 8, region: 'us-east', version: 'v126' },
  { nombre: 'Firefox', workersOcupados: 1, workersTotal: 4, region: 'us-east', version: 'v127' },
  { nombre: 'Android · emulador', workersOcupados: 4, workersTotal: 6, region: 'us-east', version: 'Pixel 8 · API 34' },
  { nombre: 'Safari · iOS', workersOcupados: 0, workersTotal: 0, region: 'macOS runner', version: 'externo', externo: true },
];

export const MINUTOS_POR_DESTINO = [
  { destino: 'Chromium', minutos: 41200, pct: 56.8, color: '#3F6FA3' },
  { destino: 'Android · emulador', minutos: 18900, pct: 26.1, color: '#2F8F5B' },
  { destino: 'Firefox', minutos: 12400, pct: 17.1, color: '#C0704A' },
  { destino: 'Safari · iOS', minutos: 0, pct: 0, color: '#9AA0AC', externo: true },
];

// 30-cell uptime strip — 2 amber (degraded) days (README §4.9).
export const UPTIME_DIAS: ('ok' | 'degradado')[] = Array.from({ length: 30 }, (_, i) =>
  i === 11 || i === 23 ? 'degradado' : 'ok',
);

// ---------------------------------------------------------------------------------------------
// Plan pricing (README §4.5). margen = (precio − costo) / precio → 81% / 72% / 79%.
// ---------------------------------------------------------------------------------------------
export const PLAN_PRICING: PlanPricing[] = [
  { plan: 'team', precioMensualUsd: 149, costoEstPorClienteUsd: 28 },
  { plan: 'business', precioMensualUsd: 499, costoEstPorClienteUsd: 142 },
  { plan: 'enterprise', precioMensualUsd: 2150, costoEstPorClienteUsd: 460 },
];

export const PLAN_FEATURES: Record<string, string[]> = {
  team: ['planes.f_team_1', 'planes.f_team_2', 'planes.f_team_3'],
  business: ['planes.f_biz_1', 'planes.f_biz_2', 'planes.f_biz_3', 'planes.f_biz_4'],
  enterprise: ['planes.f_ent_1', 'planes.f_ent_2', 'planes.f_ent_3', 'planes.f_ent_4'],
};

// ---------------------------------------------------------------------------------------------
// Ingresos aggregates (README §4.2).
// ---------------------------------------------------------------------------------------------
export const MRR_POR_PLAN = [
  { plan: 'enterprise' as const, mrr: 6450, clientes: 3 },
  { plan: 'business' as const, mrr: 1996, clientes: 4 },
  { plan: 'team' as const, mrr: 298, clientes: 2 },
];

export const COSTOS_INFRA = [
  { label: 'costos.tokens', cantidad: '486M', costoUsd: 1240 },
  { label: 'costos.runner', cantidad: '72,500', costoUsd: 422 },
  { label: 'costos.storage', cantidad: '212 GB', costoUsd: 86 },
  { label: 'costos.voz', cantidad: '1,830 min', costoUsd: 54 },
];

// ---------------------------------------------------------------------------------------------
// MRR — 12-month series (Ago 3.1k → Jul 8.7k; Jul is the current month = solid gold). Junio 8.0k
// makes the KPI +9.4% (8,744 / 7,993 ≈ 1.094).
// ---------------------------------------------------------------------------------------------
export const MRR_SERIES = [
  { mes: 'ago', valorK: 3.1 },
  { mes: 'sep', valorK: 3.6 },
  { mes: 'oct', valorK: 4.2 },
  { mes: 'nov', valorK: 4.8 },
  { mes: 'dic', valorK: 5.3 },
  { mes: 'ene', valorK: 5.9 },
  { mes: 'feb', valorK: 6.4 },
  { mes: 'mar', valorK: 6.9 },
  { mes: 'abr', valorK: 7.4 },
  { mes: 'may', valorK: 7.9 },
  { mes: 'jun', valorK: 8.0 },
  { mes: 'jul', valorK: 8.7 },
];

export const MRR_MOVEMENT = { nuevo: 648, expansion: 250, churn: 149, neto: 749 };

// ---------------------------------------------------------------------------------------------
// Auditoría — 12 entries (README §4.11). `accion` is an i18n key; `objetivo`/`ip`/`actor` are data.
// Top 5 feed the Resumen "actividad reciente".
// ---------------------------------------------------------------------------------------------
export const AUDITORIA: Auditoria[] = [
  { ts: '09:42', actor: 'Gabriel Sánchez', accion: 'audit.price_change', objetivo: 'Business $479 → $499', categoria: 'bill', ip: '201.13.4.22' },
  { ts: '09:18', actor: 'Sistema', accion: 'audit.charge_retry', objetivo: 'INV-2026-07-006 · Kappa', categoria: 'bill', ip: '—' },
  { ts: '08:57', actor: 'Daniela Ortega', accion: 'audit.api_suspend', objetivo: 'Kappa Logistics', categoria: 'sec', ip: '201.13.4.09' },
  { ts: '08:31', actor: 'Marco Peralta', accion: 'audit.user_invite', objetivo: 'sofia@omnipizza.com', categoria: 'cfg', ip: '187.22.9.140' },
  { ts: '08:04', actor: 'Sistema', accion: 'audit.pool_scale', objetivo: 'Chromium 6 → 8', categoria: 'runs', ip: '—' },
  { ts: '07:46', actor: 'Diego Herrera', accion: 'audit.sso_config', objetivo: 'Vector Bank · Okta', categoria: 'sec', ip: '190.44.3.71' },
  { ts: '07:12', actor: 'Sofía Ramírez', accion: 'audit.login', objetivo: 'OmniPizza Inc', categoria: 'auth', ip: '189.145.7.2' },
  { ts: '06:58', actor: 'Gabriel Sánchez', accion: 'audit.plan_change', objetivo: 'Aurora Health · Enterprise', categoria: 'bill', ip: '201.13.4.22' },
  { ts: '06:30', actor: 'Daniela Ortega', accion: 'audit.ws_suspend', objetivo: 'Kappa Logistics', categoria: 'cfg', ip: '201.13.4.09' },
  { ts: '05:52', actor: 'Sistema', accion: 'audit.key_rotate', objetivo: 'Aurora Health · API', categoria: 'sec', ip: '—' },
  { ts: '05:19', actor: 'Sistema', accion: 'audit.run_trigger', objetivo: 'Vector Bank · Core Banking API', categoria: 'runs', ip: '—' },
  { ts: '04:47', actor: 'Sistema', accion: 'audit.invoice_paid', objetivo: 'INV-2026-07-001 · Vector Bank', categoria: 'bill', ip: '—' },
];

// ---------------------------------------------------------------------------------------------
// Usuarios (README §4.10).
// ---------------------------------------------------------------------------------------------
export const EQUIPO_GILGAMESH = [
  { nombre: 'Gabriel Sánchez', correo: 'gabriel@gilgamesh.io', rol: 'roles.owner', dosFA: 'activa' as const, ultimaActividad: '12min' },
  { nombre: 'Daniela Ortega', correo: 'daniela@gilgamesh.io', rol: 'roles.admin', dosFA: 'activa' as const, ultimaActividad: '1h' },
  { nombre: 'Marco Peralta', correo: 'marco@gilgamesh.io', rol: 'roles.support', dosFA: 'activa' as const, ultimaActividad: '3h' },
  { nombre: 'Lucía Fernández', correo: 'lucia@gilgamesh.io', rol: 'roles.finance', dosFA: 'pendiente' as const, ultimaActividad: '1d' },
];

export const ADMINS_WORKSPACES = [
  { usuario: 'Sofía Ramírez', correo: 'sofia@omnipizza.com', wsId: 'omnipizza', rol: 'roles.owner' },
  { usuario: 'Diego Herrera', correo: 'diego@vectorbank.io', wsId: 'vectorbank', rol: 'roles.admin' },
  { usuario: 'Camila Ríos', correo: 'camila@tolteca.gg', wsId: 'tolteca', rol: 'roles.owner' },
  { usuario: 'Bruno Salas', correo: 'bruno@aurorahealth.co', wsId: 'aurora', rol: 'roles.admin' },
  { usuario: 'Valeria Nkemelu', correo: 'valeria@nimbusretail.com', wsId: 'nimbus', rol: 'roles.owner' },
];

// Team members per workspace (client detail + workspace usuarios view).
export const EQUIPO_WS: Record<string, { nombre: string; correo: string; rol: string; dosFA: 'activa' | 'pendiente'; ultimaActividad: string }[]> = {
  omnipizza: [
    { nombre: 'Sofía Ramírez', correo: 'sofia@omnipizza.com', rol: 'roles.owner', dosFA: 'activa', ultimaActividad: '20min' },
    { nombre: 'Hugo Medina', correo: 'hugo@omnipizza.com', rol: 'roles.admin', dosFA: 'activa', ultimaActividad: '2h' },
    { nombre: 'Renata Cruz', correo: 'renata@omnipizza.com', rol: 'roles.member', dosFA: 'pendiente', ultimaActividad: '1d' },
    { nombre: 'Iván Torres', correo: 'ivan@omnipizza.com', rol: 'roles.member', dosFA: 'activa', ultimaActividad: '4h' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Workspace · próximo cobro + payment method + ajustes (OmniPizza, README §5).
// ---------------------------------------------------------------------------------------------
export const WS_PROXIMO_COBRO: Record<string, { montoUsd: number; fecha: string; plan: string }> = {
  omnipizza: { montoUsd: 499, fecha: '2026-08-01', plan: 'business' },
};

export const WS_METODO_PAGO: Record<string, string> = { omnipizza: 'VISA •••• 4242' };

export const WS_AJUSTES_DEFAULT: Record<string, { nombre: string; dominio: string; formato: 'bdd' | 'cases'; retencionDias: number; notif: { slack: boolean; email: boolean; weekly: boolean } }> = {
  omnipizza: {
    nombre: 'OmniPizza Inc',
    dominio: 'omnipizza.com',
    formato: 'bdd',
    retencionDias: 60,
    notif: { slack: true, email: true, weekly: false },
  },
};

// Workspace Uso totals (README §5): 10,450 min · 212 sessions · 38 GB · queue 2.
export const WS_USO_TOTALS: Record<string, { minutos: number; sesiones: number; gb: number; cola: number }> = {
  omnipizza: { minutos: 10450, sesiones: 212, gb: 38, cola: 2 },
};
