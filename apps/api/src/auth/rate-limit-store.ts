/**
 * Port for the rate-limit counter store. The guard depends on this abstraction, not on a
 * concrete backend, so the same fixed-window logic runs over an in-memory Map (Docker-free
 * tests + quick dev) or Redis with native TTL eviction (production / multi-replica).
 */
export const RATE_LIMIT_STORE = 'RATE_LIMIT_STORE';

export interface RateLimitHit {
  /** Number of requests counted in the current window, including this one. */
  count: number;
  /** Unix epoch milliseconds at which the current window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * Atomically increments the counter for `key` within a fixed window of `windowMs` and
   * returns the resulting count and the window reset time. The first hit of a new (or expired)
   * window starts the window; subsequent hits within it keep the same `resetAt`.
   */
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}
