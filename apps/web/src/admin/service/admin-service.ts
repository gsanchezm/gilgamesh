// AdminService — the seam a real API drops in behind. `MockAdminService` reads `data/mock.ts`.
//
// COST-VISIBILITY CONTRACT (README-admin §1): platform methods MAY expose internal Gilgamesh costs
// (per-project cost, per-token cost, margins). Workspace methods MUST NOT — they return the
// cost-stripped `*Ws` view-models, built by EXPLICIT field selection (never `{...spread}`), so a
// cost field cannot leak past the type at runtime either. `admin-service.test.ts` asserts this.

import {
  ADMINS_WORKSPACES,
  AUDITORIA,
  CLIENTES,
  COSTOS_INFRA,
  EJECUCIONES,
  EQUIPO_GILGAMESH,
  EQUIPO_WS,
  FACTURAS,
  FACTURAS_WS,
  INCIDENTES,
  MINUTOS_POR_DESTINO,
  MRR_MOVEMENT,
  MRR_POR_PLAN,
  MRR_SERIES,
  PLAN_FEATURES,
  PLAN_PRICING,
  POOLS,
  PROYECTOS,
  TOKENS_AGENTE,
  TOKENS_AGENTE_WS,
  UPTIME_DIAS,
  USO_PCT,
  WS_AJUSTES_DEFAULT,
  WS_METODO_PAGO,
  WS_PROXIMO_COBRO,
  WS_USO_TOTALS,
} from '../data/mock';
import type {
  Auditoria,
  Cliente,
  ClienteDetalle,
  ClienteRow,
  IngresosView,
  MiembroEquipo,
  PlanCard,
  PlanKey,
  PlatformResumen,
  ProyectoDetalle,
  ProyectoRow,
  ProyectoRowWs,
  SaludView,
  TokensAgenteRow,
  TokensAgenteRowWs,
  UsoBar,
  UsoView,
  UsuariosView,
  WorkspaceListItem,
  WorkspaceMeta,
  WsAjustes,
  WsFacturacionView,
  WsResumen,
  WsUsoView,
  WsUsuariosView,
} from '../data/types';

export interface AdminService {
  // ---- Platform role (cost-exposing) ----
  getPlatformResumen(): PlatformResumen;
  getClientes(): ClienteRow[];
  getCliente(id: string): ClienteDetalle | undefined;
  getPlanes(): PlanCard[];
  getProyectos(): ProyectoRow[];
  getProyecto(id: string): ProyectoDetalle | undefined;
  getIngresos(): IngresosView;
  getUso(): UsoView;
  getSalud(): SaludView;
  getUsuarios(): UsuariosView;
  getAuditoria(): Auditoria[];

  // ---- Workspace role (cost-stripped) ----
  getWorkspaceList(): WorkspaceListItem[];
  getWorkspaceMeta(wsId: string): WorkspaceMeta | undefined;
  getWorkspaceResumen(wsId: string): WsResumen;
  getWorkspaceProyectos(wsId: string): ProyectoRowWs[];
  getWorkspaceUso(wsId: string): WsUsoView;
  getWorkspaceUsuarios(wsId: string): WsUsuariosView;
  getWorkspaceFacturacion(wsId: string): WsFacturacionView | undefined;
  getWorkspaceAjustes(wsId: string): WsAjustes | undefined;
}

const nf = new Intl.NumberFormat('en-US');
const usd = (n: number) => `$${nf.format(Math.round(n))}`;
const priceOf = (plan: PlanKey) => PLAN_PRICING.find((p) => p.plan === plan)?.precioMensualUsd ?? 0;

function clienteById(id: string): Cliente | undefined {
  return CLIENTES.find((c) => c.id === id);
}

/** Platform Proyecto row — joins the tenant identity + KEEPS the internal cost. */
function toProyectoRow(pId: string): ProyectoRow | undefined {
  const p = PROYECTOS.find((x) => x.id === pId);
  if (!p) return undefined;
  const c = clienteById(p.clienteId);
  return {
    id: p.id,
    clienteId: p.clienteId,
    clienteNombre: c?.nombre ?? p.clienteId,
    clienteAbbr: c?.abbr ?? '??',
    clienteColor: c?.color ?? '#9AA0AC',
    nombre: p.nombre,
    formato: p.formato,
    tipo: p.tipo,
    agentes: p.agentes,
    runs30d: p.runs30d,
    exitoPct: p.exitoPct,
    costo30d: p.costo30d,
    ultimaEjecucion: p.ultimaEjecucion,
  };
}

const teamMember = (m: { nombre: string; correo: string; rol: string; dosFA: 'activa' | 'pendiente'; ultimaActividad: string }): MiembroEquipo => ({
  nombre: m.nombre,
  correo: m.correo,
  rol: m.rol,
  dosFA: m.dosFA,
  ultimaActividad: m.ultimaActividad,
});

export class MockAdminService implements AdminService {
  // ---- Platform ----

  getPlatformResumen(): PlatformResumen {
    const topClientes = [...CLIENTES]
      .filter((c) => c.mrr > 0)
      .sort((a, b) => b.mrr - a.mrr)
      .slice(0, 5)
      .map((c) => ({ id: c.id, nombre: c.nombre, plan: c.plan, mrr: c.mrr }));

    return {
      kpis: [
        { label: 'resumen.kpi_mrr', value: '$8,744', sub: 'resumen.kpi_mrr_sub', tone: 'positive' },
        { label: 'resumen.kpi_arr', value: '$104.9k', sub: 'resumen.kpi_arr_sub' },
        { label: 'resumen.kpi_ws', value: '9 / 10', sub: 'resumen.kpi_ws_sub' },
        { label: 'resumen.kpi_margin', value: '79.4%', sub: 'resumen.kpi_margin_sub' },
        { label: 'resumen.kpi_exec', value: '1,286', sub: 'resumen.kpi_exec_sub' },
      ],
      mrrSeries: MRR_SERIES.map((p) => ({ mes: p.mes, valorK: p.valorK, actual: p.mes === 'jul' })),
      mrrMovement: MRR_MOVEMENT,
      topClientes,
      cobranza: {
        porCobrar: 648,
        vencidoMonto: 499,
        vencidoCliente: 'Kappa Logistics',
        renovaciones: 8,
        renovacionesMonto: 8744,
      },
      saludMini: { uptime: '99.96%', incidenteId: 'INC-214', cola: 12 },
      actividad: AUDITORIA.slice(0, 5),
    };
  }

  getClientes(): ClienteRow[] {
    return CLIENTES.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      dominio: c.dominio,
      abbr: c.abbr,
      color: c.color,
      plan: c.plan,
      seats: c.seats,
      seatsMax: c.seatsMax,
      mrr: c.mrr,
      usoPct: USO_PCT[c.id] ?? 0,
      estado: c.estado,
      clienteDesde: c.clienteDesde,
    }));
  }

  getCliente(id: string): ClienteDetalle | undefined {
    const c = clienteById(id);
    if (!c) return undefined;
    const proyectos = PROYECTOS.filter((p) => p.clienteId === id)
      .map((p) => toProyectoRow(p.id))
      .filter((p): p is ProyectoRow => p !== undefined);
    const costoEst30d = proyectos.reduce((s, p) => s + p.costo30d, 0);
    const margenPct = c.mrr > 0 ? Math.round(((c.mrr - costoEst30d) / c.mrr) * 1000) / 10 : 0;
    const facturas = FACTURAS.filter((f) => f.clienteId === id);
    const usoCiclo: UsoBar[] = [
      { label: 'cd.uso_exec', valor: c.ejecuciones, limite: c.ejecucionesMax, color: '#3FB07A' },
      { label: 'cd.uso_hours', valor: c.agentHours, limite: c.agentHoursMax, color: '#3F6FA3' },
      { label: 'cd.uso_voz', valor: c.vozMin, limite: c.vozMinMax, color: '#C9A14E' },
      { label: 'cd.uso_seats', valor: c.seats, limite: c.seatsMax, color: '#7E63A6' },
    ];
    return {
      cliente: c,
      kpis: [
        { label: 'cd.kpi_proyectos', value: nf.format(proyectos.length) },
        { label: 'cd.kpi_usuarios', value: `${c.seats} / ${c.seatsMax}` },
        { label: 'cd.kpi_exec', value: nf.format(c.ejecuciones) },
        { label: 'cd.kpi_costo', value: usd(costoEst30d) },
        { label: 'cd.kpi_margen', value: `${margenPct}%`, tone: 'positive' },
      ],
      usoCiclo,
      proyectos,
      facturas,
      equipo: (EQUIPO_WS[id] ?? []).map(teamMember),
      costoEst30d,
      margenPct,
    };
  }

  getPlanes(): PlanCard[] {
    return PLAN_PRICING.map((p) => ({
      plan: p.plan,
      precioMensualUsd: p.precioMensualUsd,
      costoEstPorClienteUsd: p.costoEstPorClienteUsd,
      destacado: p.plan === 'business',
      badge: p.plan === 'business' ? 'PÚBLICO' : p.plan === 'enterprise' ? 'VENTAS' : undefined,
      esContrato: p.plan === 'enterprise',
      features: PLAN_FEATURES[p.plan] ?? [],
    }));
  }

  getProyectos(): ProyectoRow[] {
    return PROYECTOS.map((p) => toProyectoRow(p.id)).filter((p): p is ProyectoRow => p !== undefined);
  }

  getProyecto(id: string): ProyectoDetalle | undefined {
    const proyecto = toProyectoRow(id);
    if (!proyecto) return undefined;
    const ejecuciones = EJECUCIONES.filter((e) => e.proyectoId === id);
    const runner = Math.round(proyecto.costo30d * 0.42);
    const tokens = Math.round(proyecto.costo30d * 0.5);
    const storage = proyecto.costo30d - runner - tokens;
    return {
      proyecto,
      kpis: [
        { label: 'pd.kpi_runs', value: nf.format(proyecto.runs30d) },
        { label: 'pd.kpi_exito', value: `${proyecto.exitoPct}%`, tone: proyecto.exitoPct >= 94 ? 'positive' : 'warn' },
        { label: 'pd.kpi_costo', value: usd(proyecto.costo30d) },
        { label: 'pd.kpi_ultima', value: proyecto.ultimaEjecucion },
      ],
      ejecuciones,
      costoDesglose: [
        { label: 'pd.costo_runner', valorUsd: runner, color: '#3F6FA3' },
        { label: 'pd.costo_tokens', valorUsd: tokens, color: '#C9A14E' },
        { label: 'pd.costo_storage', valorUsd: storage, color: '#7E63A6' },
      ],
      costoTotal: proyecto.costo30d,
    };
  }

  getIngresos(): IngresosView {
    return {
      mrrPorPlan: MRR_POR_PLAN.map((m) => ({ plan: m.plan, mrr: m.mrr, clientes: m.clientes })),
      margenPct: 79.4,
      ingresos: 8744,
      costos: 1802,
      utilidadBruta: 6942,
      costosInfra: COSTOS_INFRA.map((c) => ({ label: c.label, cantidad: c.cantidad, costoUsd: c.costoUsd })),
      costosInfraTotal: 1802,
      facturas: FACTURAS,
    };
  }

  getUso(): UsoView {
    const tokensPorAgente: TokensAgenteRow[] = TOKENS_AGENTE.map((t) => ({
      agente: t.agente,
      especialidad: t.especialidad,
      tokens30d: t.tokens30d,
      costoUsd: t.costoUsd,
      color: t.color,
      glifo: t.glifo,
    }));
    return {
      kpis: [
        { label: 'uso.kpi_min', value: '72,500' },
        { label: 'uso.kpi_sesiones', value: '1,142' },
        { label: 'uso.kpi_artefactos', value: '212 GB' },
        { label: 'uso.kpi_cola', value: '12' },
      ],
      minutosPorDestino: MINUTOS_POR_DESTINO.map((m) => ({ ...m })),
      tokensPorAgente,
      tokensTotal: 486,
      costoTotal: 1240,
    };
  }

  getSalud(): SaludView {
    return {
      kpis: [
        { label: 'salud.kpi_uptime', value: '99.96%', tone: 'positive' },
        { label: 'salud.kpi_incidentes', value: '1', tone: 'warn' },
        { label: 'salud.kpi_cola', value: '12' },
        { label: 'salud.kpi_motor', value: 'TOM v2.4.1' },
      ],
      pools: POOLS.map((p) => ({ ...p })),
      uptimeDias: [...UPTIME_DIAS],
      incidentes: INCIDENTES.map((i) => ({ ...i })),
    };
  }

  getUsuarios(): UsuariosView {
    return {
      equipoGilgamesh: EQUIPO_GILGAMESH.map(teamMember),
      adminsWorkspaces: ADMINS_WORKSPACES.map((a) => {
        const c = clienteById(a.wsId);
        return {
          usuario: a.usuario,
          correo: a.correo,
          wsId: a.wsId,
          wsNombre: c?.nombre ?? a.wsId,
          wsAbbr: c?.abbr ?? '??',
          wsColor: c?.color ?? '#9AA0AC',
          rol: a.rol,
        };
      }),
    };
  }

  getAuditoria(): Auditoria[] {
    return AUDITORIA;
  }

  // ---- Workspace (cost-stripped: no method below can emit an internal cost) ----

  getWorkspaceList(): WorkspaceListItem[] {
    // Account switcher list — abbr/name/plan only (no MRR, no cost). Explicit field selection.
    return CLIENTES.map((c) => ({ id: c.id, nombre: c.nombre, abbr: c.abbr, color: c.color, plan: c.plan }));
  }

  getWorkspaceMeta(wsId: string): WorkspaceMeta | undefined {
    const c = clienteById(wsId);
    if (!c) return undefined;
    return { id: c.id, nombre: c.nombre, abbr: c.abbr, color: c.color, plan: c.plan, precioMensualUsd: priceOf(c.plan) };
  }

  getWorkspaceResumen(wsId: string): WsResumen {
    const c = clienteById(wsId);
    const exitoPct = 93.1; // workspace success rate (README §5)
    const usoCiclo: UsoBar[] = c
      ? [
          { label: 'wsr.uso_exec', valor: c.ejecuciones, limite: c.ejecucionesMax, color: '#3FB07A' },
          { label: 'wsr.uso_hours', valor: c.agentHours, limite: c.agentHoursMax, color: '#3F6FA3' },
          { label: 'wsr.uso_voz', valor: c.vozMin, limite: c.vozMinMax, color: '#C9A14E' },
          { label: 'wsr.uso_seats', valor: c.seats, limite: c.seatsMax, color: '#7E63A6' },
        ]
      : [];
    const cobro = WS_PROXIMO_COBRO[wsId];
    return {
      kpis: c
        ? [
            { label: 'wsr.kpi_exec', value: `${nf.format(c.ejecuciones)} / ${nf.format(c.ejecucionesMax)}` },
            { label: 'wsr.kpi_hours', value: `${c.agentHours} / ${c.agentHoursMax}` },
            { label: 'wsr.kpi_exito', value: `${exitoPct}%`, tone: 'positive' },
            { label: 'wsr.kpi_seats', value: `${c.seats} / ${c.seatsMax}` },
          ]
        : [],
      usoCiclo,
      proximoCobro: {
        montoUsd: cobro?.montoUsd ?? priceOf(c?.plan ?? 'business'),
        plan: (cobro?.plan as PlanKey) ?? c?.plan ?? 'business',
        renueva: cobro?.fecha ?? '2026-08-01',
      },
      actividad: AUDITORIA.slice(3, 7),
      // Cost-stripped rows (explicit selection — no costo30d, no clienteId).
      proyectos: this.getWorkspaceProyectos(wsId),
    };
  }

  getWorkspaceProyectos(wsId: string): ProyectoRowWs[] {
    return PROYECTOS.filter((p) => p.clienteId === wsId).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      formato: p.formato,
      tipo: p.tipo,
      agentes: p.agentes,
      runs30d: p.runs30d,
      exitoPct: p.exitoPct,
      ultimaEjecucion: p.ultimaEjecucion,
      // NOTE: p.costo30d and p.clienteId are DELIBERATELY not copied — the workspace never sees them.
    }));
  }

  getWorkspaceUso(wsId: string): WsUsoView {
    const totals = WS_USO_TOTALS[wsId];
    const rows = TOKENS_AGENTE_WS[wsId] ?? [];
    // Strip the cost field explicitly — the workspace token table shows NO cost (README §5).
    const tokensPorAgente: TokensAgenteRowWs[] = rows.map((t) => ({
      agente: t.agente,
      especialidad: t.especialidad,
      tokens30d: t.tokens30d,
      color: t.color,
      glifo: t.glifo,
    }));
    const tokensTotal = Math.round(rows.reduce((s, t) => s + t.tokens30d, 0) * 10) / 10;
    return {
      kpis: totals
        ? [
            { label: 'wsu.kpi_min', value: nf.format(totals.minutos) },
            { label: 'wsu.kpi_sesiones', value: nf.format(totals.sesiones) },
            { label: 'wsu.kpi_gb', value: `${totals.gb} GB` },
            { label: 'wsu.kpi_cola', value: nf.format(totals.cola) },
          ]
        : [],
      tokensPorAgente,
      tokensTotal,
    };
  }

  getWorkspaceUsuarios(wsId: string): WsUsuariosView {
    return { equipo: (EQUIPO_WS[wsId] ?? []).map(teamMember) };
  }

  getWorkspaceFacturacion(wsId: string): WsFacturacionView | undefined {
    const c = clienteById(wsId);
    if (!c) return undefined;
    const cobro = WS_PROXIMO_COBRO[wsId];
    return {
      plan: c.plan,
      precioMensualUsd: priceOf(c.plan),
      renueva: cobro?.fecha ?? '2026-08-01',
      metodoPago: WS_METODO_PAGO[wsId] ?? 'VISA •••• 0000',
      proximoCargo: { montoUsd: cobro?.montoUsd ?? priceOf(c.plan), fecha: cobro?.fecha ?? '2026-08-01' },
      facturas: FACTURAS_WS[wsId] ?? [],
    };
  }

  getWorkspaceAjustes(wsId: string): WsAjustes | undefined {
    const a = WS_AJUSTES_DEFAULT[wsId];
    const c = clienteById(wsId);
    if (a) return { nombre: a.nombre, dominio: a.dominio, formato: a.formato, retencionDias: a.retencionDias, notif: { ...a.notif } };
    if (!c) return undefined;
    return { nombre: c.nombre, dominio: c.dominio, formato: 'bdd', retencionDias: 60, notif: { slack: true, email: true, weekly: false } };
  }
}

/** Default singleton the AdminContext provides to views. */
export const mockAdminService: AdminService = new MockAdminService();
