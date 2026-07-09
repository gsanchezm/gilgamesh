// Small formatting helpers shared across admin views (bilingual, deterministic). Read-only in Phase 2.
import type { Lang } from './data/types';

const MONTHS: Record<Lang, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const REL_UNIT: Record<Lang, Record<string, string>> = {
  es: { min: 'min', h: 'h', d: 'd' },
  en: { min: 'min', h: 'h', d: 'd' },
};

/** Render a compact relative-time code ('2h', '30min', '1d') bilingually: es "hace 2 h" / en "2 h ago". */
export function relTime(lang: Lang, code: string): string {
  const m = /^(\d+)(min|h|d)$/.exec(code);
  if (!m) return code; // '—' or already-formatted values pass through
  const n = m[1] ?? '';
  const u = m[2] ?? '';
  const unit = REL_UNIT[lang][u] ?? u;
  return lang === 'es' ? `hace ${n} ${unit}` : `${n} ${unit} ago`;
}

/** Format an ISO date ('2025-03-12') bilingually: es "12 mar 2025" / en "Mar 12, 2025". */
export function fmtDate(lang: Lang, iso: string): string {
  const [y, mo, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (!y || !mo || !d) return iso;
  const mon = MONTHS[lang][mo - 1] ?? '';
  return lang === 'es' ? `${d} ${mon} ${y}` : `${mon} ${d}, ${y}`;
}

const nf = new Intl.NumberFormat('en-US');
/** Thousands-separated integer (locale-neutral commas, matching the captures). */
export const fmtNum = (n: number): string => nf.format(Math.round(n));
/** USD amount, no cents. */
export const fmtUsd = (n: number): string => `$${nf.format(Math.round(n))}`;
/** Clamp a 0..1 ratio to a CSS width percentage string. */
export const pctWidth = (value: number, max: number): string =>
  `${Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))}%`;
