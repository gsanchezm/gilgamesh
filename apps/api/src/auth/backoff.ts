import type { IpLockoutConfig } from '../config';

/**
 * Pure exponential-backoff policy for the per-IP failure lockout (slice 39). Below the threshold
 * an IP is never locked; at/above it the lock window doubles per extra failure —
 * `base * 2^(failures - threshold)` — capped at `maxMs`. Returns the epoch-ms instant the lock
 * lifts, or `null` when the IP is not (yet) locked.
 *
 * `2^(large)` overflowing to `Infinity` is harmless: `Math.min(maxMs, Infinity) === maxMs`.
 */
export function lockedUntilFor(
  failures: number,
  cfg: Pick<IpLockoutConfig, 'threshold' | 'baseMs' | 'maxMs'>,
  nowMs: number,
): number | null {
  if (failures < cfg.threshold) return null;
  const durationMs = Math.min(cfg.maxMs, cfg.baseMs * 2 ** (failures - cfg.threshold));
  return nowMs + durationMs;
}
