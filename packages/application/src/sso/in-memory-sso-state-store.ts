import type { Clock } from '../ports/clock';
import type { SsoStateEntry, SsoStateStore } from '../ports/identity';

/** Default TTL for a pending SSO transaction (owner decision S15: 10 minutes). */
export const SSO_STATE_TTL_MS = 10 * 60 * 1000;

/** Flood guard: a `/start` storm may never grow memory unboundedly (oldest state evicted). */
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Single-instance `SsoStateStore` (the `InMemoryRateLimitStore` precedent): fine for the
 * Docker-free wirings and a single-replica deployment; a Redis adapter (native TTL + GETDEL)
 * replaces it behind the same port for multi-replica.
 */
export class InMemorySsoStateStore implements SsoStateStore {
  private readonly entries = new Map<string, { entry: SsoStateEntry; expiresAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {}

  async put(state: string, entry: SsoStateEntry, ttlMs: number): Promise<void> {
    // Map preserves insertion order → evicting the first key drops the oldest transaction.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(state, { entry, expiresAt: this.clock.now().getTime() + ttlMs });
  }

  async take(state: string): Promise<SsoStateEntry | null> {
    const hit = this.entries.get(state);
    if (!hit) return null;
    // Delete BEFORE the expiry check: a claim consumes the state no matter what, so a replay
    // can never race a slow first callback.
    this.entries.delete(state);
    if (hit.expiresAt <= this.clock.now().getTime()) return null;
    return hit.entry;
  }
}
