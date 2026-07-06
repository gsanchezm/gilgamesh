import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE } from './cookie-names';

/**
 * Single source for minting/clearing the auth cookie pair — shared by the local-login
 * controller and the SSO callback (slice 15) so an SSO session is EXACTLY a local session:
 * same `__Host-` prefix, httpOnly, Secure, SameSite=Lax, path=/.
 */
export function setSessionCookie(res: Response, token: string, maxAgeMs?: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
}

// Non-HttpOnly companion cookie for the double-submit CSRF check (must be readable by the SPA).
// maxAge tracks the session cookie on login so it isn't dropped on browser close while the session
// persists; it is also re-minted on GET /auth/me so a restored session always has a usable token.
export function setCsrfCookie(res: Response, maxAgeMs?: number): void {
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
}

// Cleared with matching attributes so the __Host- session + csrf cookies both clear.
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: true, sameSite: 'lax', path: '/' });
}
