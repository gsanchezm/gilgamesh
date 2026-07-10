/** DI token for the per-IP abuse config (slice 39). Kept in its own module so the guard, the
 *  interceptor and the stores can all import it without a guard↔store import cycle. */
export const IP_LOCKOUT = 'IP_LOCKOUT';
