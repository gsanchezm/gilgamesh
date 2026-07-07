/**
 * The typed error every HTTP primitive throws. `HttpError extends Error` and its `.message`
 * ALWAYS equals `.detail`, so existing consumers that do `catch (e) { show(e.message) }` or assert
 * `.rejects.toThrow(/detail/)` keep working unchanged (back-compat). The extra fields are additive:
 * screens and the slice-23 error boundary can branch on them
 * (`if (e instanceof HttpError && e.isTimeout) …`) without parsing message text.
 */
export interface HttpErrorInit {
  /** HTTP status, or `null` when there is no response at all (a network error or a timeout). */
  status?: number | null;
  /** The request was aborted by our own per-attempt deadline. */
  isTimeout?: boolean;
  /** `fetch` rejected (connection refused/reset, DNS) — a transport failure, not an HTTP status. */
  isNetwork?: boolean;
}

export class HttpError extends Error {
  /** HTTP status of the failing response, or `null` for a network/timeout failure (no response). */
  readonly status: number | null;
  /** Human-facing string — identical to `.message` (the RFC9457 `detail`, `fallback`, or transport text). */
  readonly detail: string;
  /** True when the failure was our `AbortController` deadline firing (not a hang). */
  readonly isTimeout: boolean;
  /** True when `fetch` itself rejected (transport error), as opposed to an HTTP error response. */
  readonly isNetwork: boolean;

  constructor(message: string, init: HttpErrorInit = {}) {
    super(message);
    this.name = 'HttpError';
    this.detail = message;
    this.status = init.status ?? null;
    this.isTimeout = init.isTimeout ?? false;
    this.isNetwork = init.isNetwork ?? false;
    // Keep `instanceof HttpError` working after transpilation to ES5-style targets.
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}
