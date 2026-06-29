import { ApplicationError } from '@gilgamesh/application';
import { ValidationPipe, type ValidationError } from '@nestjs/common';

/**
 * Shared request-validation pipe. Rejects unknown properties (anti mass-assignment) and
 * transforms payloads, and — crucially — funnels DTO validation failures through
 * ApplicationError('VALIDATION') so they surface as RFC9457 application/problem+json via
 * DomainExceptionFilter (spec: invalid input must return a Problem document, not Nest's
 * default { statusCode, message, error } shape).
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) => {
      const detail =
        errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') || 'Validation failed.';
      return new ApplicationError('VALIDATION', detail);
    },
  });
}
