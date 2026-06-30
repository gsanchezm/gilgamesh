import { ApplicationError } from '@gilgamesh/application';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

const SESSION_COOKIE = '__Host-gg_session';
const CSRF_COOKIE = 'csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Public (security: []) endpoints: unsafe but pre-session, so exempt by path even if a stale
// session cookie is still attached (e.g. AC-AUTH-04 logs in while a register cookie is present).
const PUBLIC_AUTH = ['/auth/register', '/auth/login', '/auth/forgot-password', '/auth/reset-password'];

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Double-submit CSRF check (spec api/README §CSRF, AC-AUTH-14). Every unsafe method
 * authenticated by the session cookie must carry an X-CSRF-Token header equal to the
 * non-HttpOnly `csrf` cookie; a missing/mismatched token => 403 CSRF_FAILED. Safe methods,
 * public /auth/* endpoints, and unauthenticated requests (no session cookie — let the auth
 * guard return 401) are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    if (PUBLIC_AUTH.some((p) => req.path.endsWith(p))) return true;

    const cookies = req.headers.cookie;
    if (!readCookie(cookies, SESSION_COOKIE)) return true; // unauthenticated → 401 elsewhere

    const csrfCookie = readCookie(cookies, CSRF_COOKIE);
    const raw = req.headers['x-csrf-token'];
    const csrfHeader = Array.isArray(raw) ? raw[0] : raw;
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new ApplicationError(
        'CSRF_FAILED',
        'A valid X-CSRF-Token header matching the csrf cookie is required.',
      );
    }
    return true;
  }
}
