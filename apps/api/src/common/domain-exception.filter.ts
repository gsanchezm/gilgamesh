import { ApplicationError, type AppErrorCode } from '@gilgamesh/application';
import { DomainError } from '@gilgamesh/domain';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { resolveRequestId } from './request-id';

// Express body-parser (and other http-errors middleware) throw before Nest's pipeline; their `type`
// maps to a stable client-error code so an oversized/malformed body is a precise 4xx, not a 500.
const HTTP_ERROR_CODES: Record<string, string> = {
  'entity.too.large': 'PAYLOAD_TOO_LARGE',
  'entity.parse.failed': 'MALFORMED_BODY',
  'request.aborted': 'BAD_REQUEST',
  'charset.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
  'encoding.unsupported': 'UNSUPPORTED_MEDIA_TYPE',
};

/**
 * Narrows an unknown error to an http-errors-shaped client error (4xx with `expose: true`), as
 * thrown by Express body-parser. Returns null for anything else so server/infra errors still map
 * to a generic 500 (no internals leaked).
 */
function asClientHttpError(e: unknown): { status: number; type?: string; message: string } | null {
  if (typeof e !== 'object' || e === null) return null;
  const o = e as { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown; message?: unknown };
  const raw = typeof o.status === 'number' ? o.status : typeof o.statusCode === 'number' ? o.statusCode : null;
  if (raw === null || !Number.isInteger(raw) || raw < 400 || raw >= 500 || o.expose !== true) return null;
  return {
    status: raw,
    type: typeof o.type === 'string' ? o.type : undefined,
    message: typeof o.message === 'string' ? o.message : 'The request could not be processed.',
  };
}

const STATUS: Record<AppErrorCode, number> = {
  EMAIL_IN_USE: 409,
  WEAK_PASSWORD: 422,
  INVALID_CREDENTIALS: 401,
  USER_DISABLED: 403,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_TOOL: 422,
  VALIDATION: 422,
  CSRF_FAILED: 403,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 402,
};

/**
 * Maps every error to an RFC9457 problem+json response: domain/application errors to their stable
 * code+status, Nest HttpExceptions to their status, and anything unmapped (e.g. an infra/Redis/Prisma
 * failure) to a generic 500 — so no endpoint can ever leak Nest's default `{statusCode,message}` shape.
 * Catch-all (no @Catch args) and registered as the global APP_FILTER.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    // The correlation id for this request (slice 24): the id the middleware assigned (read back off
    // the normalized request header), or — if the middleware never ran (an error raised before it) —
    // a fresh id, with the response header set here too. Stable across header · body · log.
    const requestId = resolveRequestId(http.getRequest<Request>(), res);
    const clientHttpError = asClientHttpError(exception);
    let status: number;
    let code: string;
    let detail: string;

    if (exception instanceof ApplicationError) {
      status = STATUS[exception.code];
      code = exception.code;
      detail = exception.message;
    } else if (exception instanceof DomainError) {
      status = 422;
      code = 'DOMAIN_ERROR';
      detail = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = exception.name;
      detail = exception.message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      // Unique-constraint violation (e.g. a racing create on a unique key) -> a retryable conflict.
      status = 409;
      code = 'CONFLICT';
      detail = 'That resource already exists.';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      // Update/delete of a row that was concurrently removed -> not found, not a 500.
      status = 404;
      code = 'NOT_FOUND';
      detail = 'The requested resource was not found.';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2023') {
      // Malformed id (e.g. a non-UUID reaching a uuid column) -> no such resource, not a 500.
      status = 404;
      code = 'NOT_FOUND';
      detail = 'The requested resource was not found.';
    } else if (clientHttpError) {
      // Body-parser / http-errors client error (oversized or malformed body): preserve its 4xx.
      status = clientHttpError.status;
      code = HTTP_ERROR_CODES[clientHttpError.type ?? ''] ?? (status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST');
      detail = clientHttpError.message;
    } else {
      // Unmapped (infra) error: log the real cause server-side, return a generic body so internals
      // are never leaked to the client.
      status = 500;
      code = 'INTERNAL';
      detail = 'An unexpected error occurred.';
      // Log the correlation id with the stack so an alert on this 500 joins to the client's requestId.
      this.logger.error(
        `Unhandled error [requestId=${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: code,
      status,
      code,
      detail,
      // Additive RFC9457 extension member (slice 24): lets a user quote the id from an error; equals
      // the X-Request-Id response header. The five members above are unchanged for existing consumers.
      requestId,
    });
  }
}
