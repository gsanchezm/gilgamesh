// Admin console — typed data shapes (README-admin §7) + KPI / view-model types.
// Currency is USD throughout. These shapes are the contract a real API drops in behind
// `AdminService` later; Phase 1 fills them from `data/mock.ts`.
//
// COST-VISIBILITY RULE (README-admin §1): internal Gilgamesh costs (per-project cost, per-token /
// per-minute cost, margins) exist ONLY in the platform role. The workspace-scoped view-models below
// deliberately OMIT those fields at the type level, so the workspace role is structurally unable to
// receive a cost. `MockAdminService` builds them by explicit field selection (never a spread), so
// the omission holds at runtime too.

export type PlanKey = 'team' | 'business' | 'enterprise' | 'trial';
export type EstadoCliente = 'activo' | 'trial' | 'moroso' | 'riesgo' | 'suspendido';
export type Formato = 'bdd' | 'cases';
export type TipoProyecto = 'web' | 'android' | 'api';
export type EstadoFactura = 'pagada' | 'pendiente' | 'vencida';
export type DestinoRun = 'chromium' | 'firefox' | 'android-emu' | 'http';
export type ResultadoRun = 'pass' | 'fail';
export type EstadoIncidente = 'monitoreando' | 'resuelto';
export type CategoriaAuditoria = 'auth' | 'bill' | 'cfg' | 'runs' | 'sec';
export type Lang = 'es' | 'en';
export type AdminRole = 'platform' | 'workspace';

/** A workspace (customer account). `abbr`/`color` drive the coloured avatar chip in tables. */
export interface Cliente {
  id: string;
  nombre: string;
  dominio: string;
  abbr: string;
  color: string;
  plan: PlanKey;
  mrr: number;
  seats: number;
  seatsMax: number;
  ejecuciones: number;
  ejecucionesMax: number;
  agentHours: number;
  agentHoursMax: number;
  vozMin: number;
  vozMinMax: number;
  estado: EstadoCliente;
  clienteDesde: string;
  contacto: string;
}

export interface Proyecto {
  id: string;
  clienteId: string;
  nombre: string;
  formato: Formato;
  tipo: TipoProyecto;
  agentes: string[]; // agent ids (see AGENTES roster)
  runs30d: number;
  exitoPct: number;
  costo30d: number; // PLATFORM-ONLY internal cost
  ultimaEjecucion: string;
}

export interface Factura {
  fecha: string;
  folio: string; // 'INV-2026-07-XXX'
  clienteId: string;
  montoUsd: number;
  estado: EstadoFactura;
}

export interface Ejecucion {
  id: string; // 'RUN-XXXX'
  proyectoId: string;
  fecha: string;
  destino: DestinoRun;
  escenarios: number;
  resultado: ResultadoRun;
  duracion: string;
  costoUsd: number; // PLATFORM-ONLY internal cost
  sessionUrl: string;
}

export interface Incidente {
  id: string; // 'INC-XXX'
  titulo: string;
  estado: EstadoIncidente;
  inicio: string;
  duracion: string;
}

export interface Auditoria {
  ts: string;
  actor: string;
  accion: string;
  objetivo: string;
  categoria: CategoriaAuditoria;
  ip: string;
}

export interface TokensAgente {
  agente: string; // deity alias
  especialidad: string;
  tokens30d: number; // millions of tokens (M)
  costoUsd: number; // PLATFORM-ONLY internal cost
  color: string; // discipline family colour
  glifo: string;
}

export interface Pool {
  nombre: string;
  workersOcupados: number;
  workersTotal: number;
  region: string;
  version: string;
  externo?: boolean; // Safari·iOS external capability (attenuated row)
}

export interface PlanPricing {
  plan: PlanKey;
  precioMensualUsd: number;
  costoEstPorClienteUsd: number; // margen = (precio − costo) / precio
}

// ---------------------------------------------------------------------------------------------
// View-models
// ---------------------------------------------------------------------------------------------

export type KpiTone = 'default' | 'positive' | 'negative' | 'warn';

/** A single KPI card. `value` is pre-formatted (already a string incl. currency/units). */
export interface Kpi {
  label: string; // i18n key OR literal — views pass through T()
  value: string;
  sub?: string;
  tone?: KpiTone;
}

export interface MrrPoint {
  mes: string; // month label key: 'ago' … 'jul'
  valorK: number; // MRR in thousands (e.g. 8.7)
  actual: boolean; // the current month (solid gold bar)
}

export interface MrrMovement {
  nuevo: number;
  expansion: number;
  churn: number; // stored positive; rendered as −$churn
  neto: number;
}

export interface TopCliente {
  id: string;
  nombre: string;
  plan: PlanKey;
  mrr: number;
}

export interface CobranzaView {
  porCobrar: number;
  vencidoMonto: number;
  vencidoCliente: string;
  renovaciones: number;
  renovacionesMonto: number;
}

export interface SaludMini {
  uptime: string; // '99.96%'
  incidenteId: string; // 'INC-214'
  cola: number; // queued jobs
}

/** Platform · Resumen (capture 15) — the exemplar view. */
export interface PlatformResumen {
  kpis: Kpi[];
  mrrSeries: MrrPoint[];
  mrrMovement: MrrMovement;
  topClientes: TopCliente[];
  cobranza: CobranzaView;
  saludMini: SaludMini;
  actividad: Auditoria[]; // most-recent 5 audit entries
}

/** A cliente row for the platform Clientes table (revenue + status; platform-only surface). */
export interface ClienteRow {
  id: string;
  nombre: string;
  dominio: string;
  abbr: string;
  color: string;
  plan: PlanKey;
  seats: number;
  seatsMax: number;
  mrr: number;
  usoPct: number; // cycle usage %
  estado: EstadoCliente;
  clienteDesde: string;
}

/** Platform Proyectos row — HAS internal cost + tenant identity. */
export interface ProyectoRow {
  id: string;
  clienteId: string;
  clienteNombre: string;
  clienteAbbr: string;
  clienteColor: string;
  nombre: string;
  formato: Formato;
  tipo: TipoProyecto;
  agentes: string[];
  runs30d: number;
  exitoPct: number;
  costo30d: number;
  ultimaEjecucion: string;
}

/** Workspace Proyectos row — cost-stripped: NO `costo30d`, NO tenant identity. */
export interface ProyectoRowWs {
  id: string;
  nombre: string;
  formato: Formato;
  tipo: TipoProyecto;
  agentes: string[];
  runs30d: number;
  exitoPct: number;
  ultimaEjecucion: string;
}

/** Platform token-per-agent row — HAS internal cost. */
export interface TokensAgenteRow {
  agente: string;
  especialidad: string;
  tokens30d: number;
  costoUsd: number;
  color: string;
  glifo: string;
}

/** Workspace token-per-agent row — cost-stripped: NO `costoUsd`. */
export interface TokensAgenteRowWs {
  agente: string;
  especialidad: string;
  tokens30d: number;
  color: string;
  glifo: string;
}

/** A usage bar (value vs limit) reused across usage/cycle panels. */
export interface UsoBar {
  label: string;
  valor: number;
  limite: number;
  color: string;
}

/** Platform · Ingresos (§4.2). */
export interface IngresosView {
  mrrPorPlan: { plan: PlanKey; mrr: number; clientes: number }[];
  margenPct: number; // 79.4
  ingresos: number;
  costos: number;
  utilidadBruta: number;
  costosInfra: { label: string; cantidad: string; costoUsd: number }[];
  costosInfraTotal: number;
  facturas: Factura[];
}

/** Platform · Detalle de cliente (§4.4). */
export interface ClienteDetalle {
  cliente: Cliente;
  kpis: Kpi[];
  usoCiclo: UsoBar[];
  proyectos: ProyectoRow[];
  facturas: Factura[];
  equipo: MiembroEquipo[];
  costoEst30d: number;
  margenPct: number;
}

export interface MiembroEquipo {
  nombre: string;
  correo: string;
  rol: string;
  dosFA: 'activa' | 'pendiente';
  ultimaActividad: string;
}

/** Platform · Planes y precios (§4.5). */
export interface PlanCard {
  plan: PlanKey;
  precioMensualUsd: number;
  costoEstPorClienteUsd: number;
  destacado: boolean; // Business — highlighted
  badge?: string; // 'PÚBLICO' | 'VENTAS'
  esContrato?: boolean; // Enterprise: the field is the average contract value
  features: string[];
}

/** Platform · Detalle de proyecto (§4.7). */
export interface ProyectoDetalle {
  proyecto: ProyectoRow;
  kpis: Kpi[];
  ejecuciones: Ejecucion[];
  costoDesglose: { label: string; valorUsd: number; color: string }[];
  costoTotal: number;
}

/** Platform · Uso de agentes y runners (§4.8). */
export interface UsoView {
  kpis: Kpi[];
  minutosPorDestino: { destino: string; minutos: number; pct: number; color: string; externo?: boolean }[];
  tokensPorAgente: TokensAgenteRow[];
  tokensTotal: number;
  costoTotal: number;
}

/** Platform · Salud del sistema (§4.9). */
export interface SaludView {
  kpis: Kpi[];
  pools: Pool[];
  uptimeDias: ('ok' | 'degradado')[]; // 30 cells
  incidentes: Incidente[];
}

/** Platform · Usuarios y roles (§4.10). */
export interface UsuariosView {
  equipoGilgamesh: MiembroEquipo[];
  adminsWorkspaces: { usuario: string; correo: string; wsId: string; wsNombre: string; wsAbbr: string; wsColor: string; rol: string }[];
}

// ---- Workspace-scoped view-models (cost-free) ------------------------------------------------

export interface WorkspaceMeta {
  id: string;
  nombre: string;
  abbr: string;
  color: string;
  plan: PlanKey;
  precioMensualUsd: number;
}

/** A row of the workspace-switcher account list (abbr + name + plan only — no revenue, no cost). */
export interface WorkspaceListItem {
  id: string;
  nombre: string;
  abbr: string;
  color: string;
  plan: PlanKey;
}

/** Workspace · Resumen (capture 21). No internal cost anywhere. */
export interface WsResumen {
  kpis: Kpi[];
  usoCiclo: UsoBar[];
  proximoCobro: { montoUsd: number; plan: PlanKey; renueva: string };
  actividad: Auditoria[];
  proyectos: ProyectoRowWs[];
}

/** Workspace · Uso — totals are the workspace's own; the token table carries NO cost. */
export interface WsUsoView {
  kpis: Kpi[];
  tokensPorAgente: TokensAgenteRowWs[];
  tokensTotal: number;
}

export interface WsUsuariosView {
  equipo: MiembroEquipo[];
}

export interface WsFacturacionView {
  plan: PlanKey;
  precioMensualUsd: number;
  renueva: string;
  metodoPago: string; // 'VISA •••• 4242'
  proximoCargo: { montoUsd: number; fecha: string };
  facturas: Factura[];
}

export interface WsAjustes {
  nombre: string;
  dominio: string;
  formato: Formato;
  retencionDias: number;
  notif: { slack: boolean; email: boolean; weekly: boolean };
}
