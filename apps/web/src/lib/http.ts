import { readCsrfToken } from './csrf';
import { HttpError } from './http-error';

/**
 * Shared HTTP primitives for the typed API clients. Every client used to redeclare these verbatim
 * (audit R2); they live here once so `API_BASE`, error handling and the CSRF double-submit stay
 * consistent.
 *
 * Slice 25 adds resilience behind the SAME signatures (an optional trailing `opts` is a pure
 * test/tuning seam — no call site changes): a per-attempt **timeout** (`AbortController`) so a
 * stalled request fails fast instead of hanging, a bounded **retry-with-backoff** for **idempotent
 * GETs only** on transient failures (a network error or a 502/503/504), and a **typed error**
 * (`HttpError`) whose `.message` is unchanged. Mutations are NEVER retried (a replayed POST could
 * double-create/double-charge). See `specs/slices/25-web-http-resilience/`.
 */

/** Re-exported so clients keep a single import surface (`./http`). */
export { HttpError } from './http-error';

/** API base URL — same-origin `/api/v1` in dev (vite proxy), overridable via env for other deployments. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Statuses treated as transient (worth a retry on an idempotent GET): the classic gateway/unavailable set. */
const TRANSIENT_STATUS: ReadonlySet<number> = new Set([502, 503, 504]);

/** Tunable resilience policy. Defaults below; tests inject an instant `sleep` + a tiny `timeoutMs`. */
export interface RetryPolicy {
  /** Retries for an idempotent GET (default 2 → up to 3 attempts). Mutations always use 0. */
  retries: number;
  /** Per-attempt `AbortController` deadline in ms (default 10_000). */
  timeoutMs: number;
  /** 0-based attempt index → ms to wait before the next try (default `200 · 2^n` → 200, 400). */
  backoffMs: (attempt: number) => number;
  /** Injectable delay (default `setTimeout`); overridden in tests so backoff is instant. */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_POLICY: RetryPolicy = {
  retries: 2,
  timeoutMs: 10_000,
  backoffMs: (attempt) => 200 * 2 ** attempt,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function policyFrom(opts?: Partial<RetryPolicy>): RetryPolicy {
  return opts ? { ...DEFAULT_POLICY, ...opts } : DEFAULT_POLICY;
}

/**
 * Runs one `fetch` with a timeout deadline, retrying (only when `retryable`) on transient failures
 * with backoff, and returns the final `Response`. Response-body reading is left to `ok` — the
 * discarded Response on a retried attempt is never consumed here.
 */
async function fetchWithResilience(
  url: string,
  init: RequestInit,
  retryable: boolean,
  policy: RetryPolicy,
): Promise<Response> {
  const maxRetries = retryable ? policy.retries : 0;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      // A transient server error on an idempotent request → back off and retry (if any left).
      if (retryable && TRANSIENT_STATUS.has(res.status) && attempt < maxRetries) {
        await policy.sleep(policy.backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);

      // Our own deadline fired → a timeout. Terminal: never retried (the budget is already spent).
      if (controller.signal.aborted) {
        throw new HttpError('The request timed out. Please try again.', { isTimeout: true });
      }

      // Otherwise `fetch` rejected on its own: a transport/network error. Retryable for GETs.
      if (attempt < maxRetries) {
        await policy.sleep(policy.backoffMs(attempt));
        continue;
      }
      throw new HttpError('Could not reach the server. Check your connection and try again.', {
        isNetwork: true,
      });
    }
  }
}

/** Resolves a Response to JSON, or throws a typed `HttpError` with the RFC9457 `detail` (falling back to `fallback`). */
export async function ok<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const problem = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new HttpError(problem.detail ?? fallback, { status: res.status });
  }
  return (await res.json()) as T;
}

/** GET `path` with the session cookie → JSON. Idempotent: retried with backoff on transient failures. */
export function getJson<T>(path: string, fallback: string, opts?: Partial<RetryPolicy>): Promise<T> {
  return fetchWithResilience(`${API_BASE}${path}`, { credentials: 'include' }, true, policyFrom(opts)).then(
    (r) => ok<T>(r, fallback),
  );
}

/**
 * Send `method` `path` with a JSON body + the CSRF double-submit header → JSON. NON-idempotent, so
 * it is NEVER retried (a replayed POST/PATCH could double-create/double-charge) — it only gains the
 * timeout + the typed error.
 */
export function sendJson<T>(
  method: string,
  path: string,
  body: unknown,
  fallback: string,
  opts?: Partial<RetryPolicy>,
): Promise<T> {
  return fetchWithResilience(
    `${API_BASE}${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCsrfToken() },
      credentials: 'include',
      body: JSON.stringify(body ?? {}),
    },
    false,
    policyFrom(opts),
  ).then((r) => ok<T>(r, fallback));
}
