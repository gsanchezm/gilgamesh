/**
 * Single source of truth for the auth cookie names. Previously duplicated across the auth
 * controller, the CSRF guard and the session guard — a rename in one place would silently break
 * the others. The `__Host-` prefix is load-bearing: it forces Secure + path=/ + no Domain, so the
 * cookie can't be overwritten by a subdomain (session fixation defense).
 */
export const SESSION_COOKIE = '__Host-gg_session';
export const CSRF_COOKIE = 'csrf';
