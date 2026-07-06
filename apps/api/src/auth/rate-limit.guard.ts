import { ApplicationError, type Clock } from '@gilgamesh/application';
import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RateLimitConfig } from '../config';
import { TOKENS } from '../persistence/tokens';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit-store';

export const RATE_LIMIT = 'RATE_LIMIT';

interface LimitedPath {
  suffix: string;
  /** Restrict the throttle to one HTTP method; omitted = any method with this suffix. */
  method?: string;
  /** 'suffix' buckets across the dynamic path segment (per IP); 'path' (default) per full path. */
  bucket?: 'path' | 'suffix';
}

// Throttled endpoints: auth (AC-AUTH-13 / §10.2; forgot/reset implemented by slice 12) and the
// cost-bearing brain calls — AI generate (AC-GEN-04) and chat send (AC-CHAT-06).
const LIMITED_PATHS: LimitedPath[] = [
  { suffix: '/auth/login' },
  { suffix: '/auth/register' },
  { suffix: '/auth/forgot-password' },
  { suffix: '/auth/reset-password' },
  // SSO (slice 15, AC-SSO-08): GETs carry no email, so these bind per (path + IP). Explicit
  // per-provider entries — an unknown {provider} 404s before doing any work anyway.
  { suffix: '/auth/sso/google/start', method: 'GET' },
  { suffix: '/auth/sso/google/callback', method: 'GET' },
  { suffix: '/test-cases/generate' },
  // POST-only so a future GET message-list is not throttled, and bucketed by SUFFIX so minting
  // fresh sessions cannot mint fresh buckets — the brain-cost limit binds per IP (review S8).
  { suffix: '/messages', method: 'POST', bucket: 'suffix' },
];

/**
 * Fixed-window rate limit on auth endpoints, keyed by (path + IP + email) — per-IP-per-account.
 * Counting is delegated to a {@link RateLimitStore} port (in-memory single-instance, or Redis with
 * native TTL eviction for multi-replica). Exceeding the window => 429 RATE_LIMITED + Retry-After;
 * every throttled response carries the X-RateLimit-* headers.
 *
 * Deferred (§10.2): a per-IP-only bound (org-farming) and exponential-backoff account lockout (N=10).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(RATE_LIMIT) private readonly opts: RateLimitConfig,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    // Strip trailing slashes before matching: Express non-strict routing dispatches "/auth/login/"
    // to the same handler, so an un-normalized endsWith would let a trailing slash dodge the bucket.
    const normalizedPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const limited = LIMITED_PATHS.find(
      (p) => normalizedPath.endsWith(p.suffix) && (!p.method || p.method === req.method),
    );
    if (!limited) return true;

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const body = req.body as { email?: unknown } | undefined;
    // Normalize identically to the auth use cases (which trim+lowercase) so whitespace-padded
    // variants can't mint fresh buckets for the same account and bypass the throttle.
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Default: key on the full normalized path so the parameterized /projects/:id/test-cases/generate
    // route buckets per (project + IP). 'suffix' entries key on the static suffix instead, so a
    // dynamic segment (e.g. a fresh chat sessionId) cannot mint a fresh bucket.
    const key = `${limited.bucket === 'suffix' ? limited.suffix : normalizedPath}:${ip}:${email}`;

    let hit: { count: number; resetAt: number };
    try {
      hit = await this.store.hit(key, this.opts.windowMs);
    } catch (err) {
      // Fail open: a rate-limit store (Redis) outage must not take down auth. Degrade to no
      // throttling for the blip rather than 500-ing every login/register.
      this.logger.warn(`rate-limit store unavailable, allowing request: ${String(err)}`);
      return true;
    }
    const { count, resetAt } = hit;

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('X-RateLimit-Limit', String(this.opts.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, this.opts.limit - count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > this.opts.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((resetAt - this.clock.now().getTime()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      throw new ApplicationError('RATE_LIMITED', 'Too many requests. Please retry later.');
    }
    return true;
  }
}
