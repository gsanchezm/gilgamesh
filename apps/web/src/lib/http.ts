import { readCsrfToken } from './csrf';

/**
 * Shared HTTP primitives for the typed API clients. Every client used to redeclare these verbatim
 * (audit R2); they live here once so `API_BASE`, error handling and the CSRF double-submit stay consistent.
 */

/** API base URL — same-origin `/api/v1` in dev (vite proxy), overridable via env for other deployments. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Resolves a Response to JSON, or throws with the RFC9457 `detail` (falling back to `fallback`). */
export async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(problem.detail ?? fallback);
  }
  return (await res.json()) as T;
}

/** GET `path` with the session cookie → JSON. */
export function getJson<T>(path: string, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { credentials: 'include' }).then((r) => ok<T>(r, fallback));
}

/** Send `method` `path` with a JSON body + the CSRF double-submit header → JSON. */
export function sendJson<T>(method: string, path: string, body: unknown, fallback: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
    credentials: 'include',
    body: JSON.stringify(body ?? {}),
  }).then((r) => ok<T>(r, fallback));
}
