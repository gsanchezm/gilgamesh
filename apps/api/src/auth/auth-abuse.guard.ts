import { ApplicationError, type Clock } from '@gilgamesh/application';
import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IP_LOCKOUT } from './abuse-tokens';
import { ceilingKeyForIp, clientIp, lockoutKeyForIp } from './client-ip';
import { LOGIN_ATTEMPT_STORE, type LoginAttemptStore } from './login-attempt-store';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store';
import type { IpLockoutConfig } from '../config';
import { TOKENS } from '../persistence/tokens';

interface AbusePath {
  suffix: string;
  method: string;
  /** Feed + pre-check the failure lockout (A2) for this route (credential surfaces only). */
  lockout?: boolean;
  /** Count this route toward the per-IP request ceiling (A1). Defaults to true; login opts OUT. */
  ceiling?: boolean;
}

// Auth mutation routes covered by the guard. The per-IP request ceiling (A1) applies to
// register/forgot/reset (org-farming / spray). LOGIN is deliberately EXCLUDED from A1 (ceiling:
// false): a shared per-IP request ceiling that counts *successful* logins is NAT-hostile — a
// corporate egress IP with a login surge would 429 legitimate users. Login abuse is instead bounded
// by the A2 failure lockout (NAT-safe: it counts only failed attempts and clears on success) plus
// the per-account RateLimitGuard. login + reset-password carry the A2 lockout. forgot-password is
// enumeration-safe (never "fails") but still counts toward the ceiling; register counts too. SSO
// GETs already bucket per-IP in RateLimitGuard; the authenticated surfaces are out of scope here.
const ABUSE_PATHS: AbusePath[] = [
  { suffix: '/auth/login', method: 'POST', lockout: true, ceiling: false },
  { suffix: '/auth/register', method: 'POST' },
  { suffix: '/auth/forgot-password', method: 'POST' },
  { suffix: '/auth/reset-password', method: 'POST', lockout: true },
];

/**
 * Additive per-IP abuse guard (slice 39), a sibling of RateLimitGuard (which stays the per-account
 * fixed window). Two protections, BOTH keyed on the client IP so an attacker can never lock a
 * victim out (they only ever lock their own IP):
 *   A1 · a per-IP request ceiling across the auth mutation routes (org-farming / spray)
 *   A2 · an exponential-backoff lockout after N consecutive failed credential attempts (stuffing)
 *
 * Fail-open: a store outage degrades to "allow" (a warning log), matching RateLimitGuard — an
 * infra blip must never take auth down. The LoginOutcomeInterceptor feeds the A2 counter.
 */
@Injectable()
export class AuthAbuseGuard implements CanActivate {
  private readonly logger = new Logger(AuthAbuseGuard.name);

  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(LOGIN_ATTEMPT_STORE) private readonly attempts: LoginAttemptStore,
    @Inject(IP_LOCKOUT) private readonly cfg: IpLockoutConfig,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const normalizedPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const matched = ABUSE_PATHS.find(
      (p) => normalizedPath.endsWith(p.suffix) && p.method === req.method,
    );
    if (!matched) return true;

    const ip = clientIp(req);
    const res = context.switchToHttp().getResponse<Response>();

    // A2 — reject a locked IP before doing anything else (a locked IP shouldn't even consume the
    // ceiling budget). Our own 429 must survive the fail-open catch; only a store outage fails open.
    if (matched.lockout) {
      try {
        const state = await this.attempts.getState(lockoutKeyForIp(ip));
        if (state.lockedUntil !== null && state.lockedUntil > this.clock.now().getTime()) {
          this.setRetryAfter(res, state.lockedUntil);
          throw new ApplicationError('RATE_LIMITED', 'Too many failed attempts. Please retry later.');
        }
      } catch (err) {
        if (err instanceof ApplicationError) throw err;
        this.logger.warn(`lockout store unavailable, allowing request: ${String(err)}`);
      }
    }

    // A1 — per-IP ceiling across the auth mutation routes (one shared budget per IP). Skipped for
    // routes that opt out (login), so a NAT'd login surge is never ceiling'd (it relies on A2).
    if (matched.ceiling === false) return true;
    try {
      const hit = await this.store.hit(ceilingKeyForIp(ip), this.cfg.ipWindowMs);
      if (hit.count > this.cfg.ipLimit) {
        this.setRetryAfter(res, hit.resetAt);
        throw new ApplicationError(
          'RATE_LIMITED',
          'Too many requests from this network. Please retry later.',
        );
      }
    } catch (err) {
      if (err instanceof ApplicationError) throw err;
      this.logger.warn(`ip-ceiling store unavailable, allowing request: ${String(err)}`);
    }

    return true;
  }

  private setRetryAfter(res: Response, untilMs: number): void {
    const retryAfterSec = Math.max(1, Math.ceil((untilMs - this.clock.now().getTime()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
  }
}
