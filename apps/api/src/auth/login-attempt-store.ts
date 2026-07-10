/**
 * Port for the per-IP failure-lockout counter (slice 39). The AuthAbuseGuard reads the lock state
 * (pre-handler); the LoginOutcomeInterceptor records a failure on a bad credential attempt and
 * clears on success. Two adapters: in-memory (Docker-free / single instance) and Redis with native
 * TTL (multi-replica), selected by REDIS_URL — the RateLimitStore idiom.
 *
 * The backoff POLICY (when/how long to lock) lives in the store (it owns the IpLockoutConfig), so
 * the guard/interceptor stay policy-free: they only read state and report outcomes.
 */
export const LOGIN_ATTEMPT_STORE = 'LOGIN_ATTEMPT_STORE';

export interface LoginAttemptState {
  /** Consecutive failures recorded in the current retention window. */
  failures: number;
  /** Epoch ms the lock lifts, or null when the key is not locked. */
  lockedUntil: number | null;
}

export interface LoginAttemptStore {
  /** Record one failed credential attempt for `key` at `now` (epoch ms); returns the new state
   *  (incl. any lock the failure just triggered). */
  recordFailure(key: string, now: number): Promise<LoginAttemptState>;
  /** Clear the counter for `key` (a successful attempt). */
  clear(key: string): Promise<void>;
  /** Read the current state for `key` without mutating it. */
  getState(key: string): Promise<LoginAttemptState>;
}
