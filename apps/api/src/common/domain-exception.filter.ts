import { ApplicationError, type AppErrorCode } from '@gilgamesh/application';
import { DomainError } from '@gilgamesh/domain';
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
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
};

/** Maps domain/application errors to RFC9457-shaped responses with stable titles. */
@Catch(ApplicationError, DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: ApplicationError | DomainError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof ApplicationError ? STATUS[exception.code] : 422;
    const code = exception instanceof ApplicationError ? exception.code : 'DOMAIN_ERROR';
    res.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: code,
      status,
      code,
      detail: exception.message,
    });
  }
}
