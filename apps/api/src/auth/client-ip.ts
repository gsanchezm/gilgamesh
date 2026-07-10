import type { Request } from 'express';

/**
 * The client IP used as the abuse key (slice 39). Identical derivation to RateLimitGuard so the
 * guard's lock check and the interceptor's failure recording agree on the same bucket. Correctness
 * depends on Express `trust proxy` (config.trustProxy) matching the appending-proxy hop count.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** Failure-lockout bucket (A2) — per IP, shared by login + reset-password so an attacker cannot
 *  dodge the lock by switching between the two credential surfaces. */
export function lockoutKeyForIp(ip: string): string {
  return `auth-lock:${ip}`;
}

/** Per-IP request-ceiling bucket (A1) — one budget per IP across ALL auth mutation routes, so
 *  spray across many accounts/endpoints from one source is caught (the per-account window is not). */
export function ceilingKeyForIp(ip: string): string {
  return `auth-ceil:${ip}`;
}
