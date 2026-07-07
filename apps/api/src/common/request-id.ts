import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/** The request/response correlation-id header (slice 24). Echoed on every response, quoted in the
 *  RFC9457 error body, and logged with the stack on an unmapped 500. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Max accepted length of a *client-supplied* correlation id. A UUID is 36 chars; 128 is generous
 * headroom while bounding how many bytes an attacker can push into the response header / server log
 * per request (unbounded-input guard).
 */
export const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Safe charset for a correlation id: opaque token characters only. Excludes every control character
 * (CR, LF, tab), whitespace, `:`, `;`, `<`, `>`, quotes and JSON punctuation — so a trusted id is
 * safe to concatenate into an HTTP header value (no header-injection) and into a log line (no
 * log-injection). A server-generated UUID (`[0-9a-f-]`) is itself inside this set, which is
 * load-bearing: the filter re-normalizes the header the middleware wrote, so a generated id must
 * pass its own check to stay stable.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Returns a trusted correlation id: the caller-supplied value when it is a sane, bounded, opaque
 * token (non-empty, ≤ {@link REQUEST_ID_MAX_LENGTH}, matching the safe charset), else a fresh
 * server-generated UUID. Never trusts arbitrary client input into the response header or the logs.
 * A duplicated header arrives from Express as `"a, b"` (comma + space) and is rejected → regenerated.
 */
export function normalizeRequestId(supplied: unknown): string {
  if (
    typeof supplied === 'string' &&
    supplied.length > 0 &&
    supplied.length <= REQUEST_ID_MAX_LENGTH &&
    REQUEST_ID_PATTERN.test(supplied)
  ) {
    return supplied;
  }
  return randomUUID();
}

/**
 * Resolves the correlation id for the current request from the (already normalized, if the
 * middleware ran) `X-Request-Id` request header, ensures the response echoes it, and returns it.
 * Idempotent and safe to call even if the middleware never ran (e.g. an error raised before it):
 * it normalizes the raw header and sets the response header itself, so the id is always stable
 * across header · body · log. Used by both the middleware and the exception filter.
 */
export function resolveRequestId(req: Request | undefined, res: Response): string {
  const id = normalizeRequestId(req?.headers?.['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Express middleware that assigns every request a correlation id — the caller's when it is a sane
 * bounded token, else a fresh UUID — writes the normalized id back onto the request header (the
 * single source of truth the exception filter reads) and echoes it on the response.
 *
 * Registered FIRST in `main.ts` (before {@link configureBodyParser}) so even a body-parser error
 * carries the id — though correctness does not depend on that ordering: the filter's fallback
 * independently normalizes the raw header and sets the response header. Called from the e2e harness
 * too so the wiring is identical and verifiable.
 */
export function configureRequestId(app: NestExpressApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = resolveRequestId(req, res);
    req.headers['x-request-id'] = id;
    next();
  });
}
