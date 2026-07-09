// Admin console i18n — scoped `T(lang, key)` over a registry that MERGES every per-view dict module.
//
// SEAM (why Phase 2 never touches this file): every view module is imported and registered HERE, up
// front, in Phase 1. A Phase-2 group fills only its own `i18n/<view>.ts` (keys namespaced by its
// prefix). Because the module is already registered, the new keys are picked up with NO edit to this
// index or any other shared file — two groups editing different modules cannot collide.
//
// Lookup order: current lang → English fallback → the key itself (so a missing key renders visibly,
// never throws).
import type { Lang } from '../data/types';
import type { ViewDict } from './dict';

// Phase-1-owned (filled).
import audit from './audit';
import common from './common';
import resumen from './resumen';
import shell from './shell';
// Phase-2-owned stubs (pre-registered; each group fills its own).
import auditoria from './auditoria';
import clienteDetalle from './clienteDetalle';
import clientes from './clientes';
import ingresos from './ingresos';
import planes from './planes';
import proyectoDetalle from './proyectoDetalle';
import proyectos from './proyectos';
import salud from './salud';
import uso from './uso';
import usuarios from './usuarios';
import wsAjustes from './wsAjustes';
import wsFacturacion from './wsFacturacion';
import wsProyectos from './wsProyectos';
import wsResumen from './wsResumen';
import wsUso from './wsUso';
import wsUsuarios from './wsUsuarios';

/** Every registered dict module (exported so tests can assert es/en key parity across all of them). */
export const MODULES: ViewDict[] = [
  // shared / Phase-1
  shell,
  resumen,
  common,
  audit,
  // platform (Phase 2)
  ingresos,
  clientes,
  clienteDetalle,
  planes,
  proyectos,
  proyectoDetalle,
  uso,
  salud,
  usuarios,
  auditoria,
  // workspace (Phase 2)
  wsResumen,
  wsProyectos,
  wsUso,
  wsUsuarios,
  wsFacturacion,
  wsAjustes,
];

function mergeLang(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const mod of MODULES) Object.assign(out, mod[lang]);
  return out;
}

// Built once at import (the dicts are static).
const DICT: Record<Lang, Record<string, string>> = {
  es: mergeLang('es'),
  en: mergeLang('en'),
};

/** Translate `key` for `lang`; falls back to English, then to the key itself. */
export function T(lang: Lang, key: string): string {
  return DICT[lang][key] ?? DICT.en[key] ?? key;
}

/** A bound translator for a fixed language (convenience for a rendering view). */
export const translator = (lang: Lang) => (key: string) => T(lang, key);
