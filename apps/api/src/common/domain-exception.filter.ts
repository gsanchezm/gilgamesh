import { ApplicationError, type AppErrorCode } from '@gilgamesh/application';
import { DomainError } from '@gilgamesh/domain';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

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
    const res = host.switchToHttp().getResponse<Response>();
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
    } else {
      // Unmapped (infra) error: log the real cause server-side, return a generic body so internals
      // are never leaked to the client.
      status = 500;
      code = 'INTERNAL';
      detail = 'An unexpected error occurred.';
      this.logger.error('Unhandled error', exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: code,
      status,
      code,
      detail,
    });
  }
}
