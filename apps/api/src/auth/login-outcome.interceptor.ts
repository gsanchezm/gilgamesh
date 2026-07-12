import { ApplicationError, type Clock } from '@gilgamesh/application';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable, catchError, from, mergeMap, tap, throwError } from 'rxjs';
import { clientIp, lockoutKeyForIp } from './client-ip';
import { LOGIN_ATTEMPT_STORE, type LoginAttemptStore } from './login-attempt-store';
import { TOKENS } from '../persistence/tokens';

interface OutcomeRoute {
  suffix: string;
  method: string;
  /** Domain error codes on this route that count as a brute-force failure (fed to the lockout). */
  failureCodes: string[];
}

// Only the two credential surfaces feed the per-IP lockout: a wrong password (INVALID_CREDENTIALS)
// and a well-formed-but-invalid/expired reset TOKEN (RESET_TOKEN_INVALID). We deliberately do NOT
// count plain VALIDATION on reset-password: the global ValidationPipe maps every DTO failure —
// including a legit user's too-short new password — to ApplicationError('VALIDATION'), which is not
// a credential-guessing signal. The dedicated RESET_TOKEN_INVALID code (thrown only by the
// ResetPassword use case for a bad token) is what isolates the real attack from the fumble.
const OUTCOME_ROUTES: OutcomeRoute[] = [
  { suffix: '/auth/login', method: 'POST', failureCodes: ['INVALID_CREDENTIALS'] },
  { suffix: '/auth/reset-password', method: 'POST', failureCodes: ['RESET_TOKEN_INVALID'] },
];

/**
 * Records the outcome of a credential attempt for the per-IP lockout (slice 39). Success clears the
 * IP's failure counter; a matching domain failure records one (and is awaited before the error
 * propagates, so the count is durable before the client can retry). Runs globally but no-ops for
 * every non-credential route. Store errors are swallowed (fail-open) — recording must never turn a
 * 401 into a 500.
 */
@Injectable()
export class LoginOutcomeInterceptor implements NestInterceptor {
  constructor(
    @Inject(LOGIN_ATTEMPT_STORE) private readonly attempts: LoginAttemptStore,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const normalizedPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const route = OUTCOME_ROUTES.find(
      (r) => normalizedPath.endsWith(r.suffix) && r.method === req.method,
    );
    if (!route) return next.handle();

    const key = lockoutKeyForIp(clientIp(req));

    return next.handle().pipe(
      tap(() => {
        // Success → clear. In-memory clear is synchronous; a Redis outage is swallowed.
        void this.attempts.clear(key).catch(() => undefined);
      }),
      catchError((err: unknown) => {
        const isFailure =
          err instanceof ApplicationError && route.failureCodes.includes(err.code);
        if (!isFailure) return throwError(() => err);
        return from(
          this.attempts.recordFailure(key, this.clock.now().getTime()).catch(() => undefined),
        ).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}
