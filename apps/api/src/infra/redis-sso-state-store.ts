import type { SsoStateEntry, SsoStateStore } from '@gilgamesh/application';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * The minimal ioredis surface this adapter needs — the unit-test seam (the `SmtpTransport`
 * idiom): tests inject a fake; the default factory builds a real `ioredis` client.
 */
export interface RedisSsoClient {
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
  quit(): Promise<unknown>;
}

/**
 * Redis-backed {@link SsoStateStore} for multi-replica deployments (the `RedisRateLimitStore`
 * precedent — selected by `REDIS_URL` at the AuthModule binding; the in-memory store stays the
 * Docker-free default):
 * - `put` = one `SET … PX <ttlMs>` — expiry is native Redis TTL (same 10-min TTL the in-memory
 *   store uses, passed by the caller), so keys self-evict and a `/start` flood cannot grow
 *   memory unboundedly (no explicit cap needed; the per-IP rate limit bounds the flood).
 * - `take` = one atomic `GETDEL` — the claim returns AND deletes in a single command, so a
 *   replayed `state` can never race a slow first callback, even across API replicas.
 * The state value and the stored entry (nonce / PKCE verifier) are secrets: they are never
 * logged and never embedded in an error — a corrupt row simply claims as `null`.
 */
@Injectable()
export class RedisSsoStateStore implements SsoStateStore, OnModuleDestroy {
  private readonly redis: RedisSsoClient;

  constructor(
    url: string,
    makeClient: (url: string) => RedisSsoClient = (u) =>
      new Redis(u, { maxRetriesPerRequest: 3 }),
  ) {
    this.redis = makeClient(url);
  }

  async put(state: string, entry: SsoStateEntry, ttlMs: number): Promise<void> {
    await this.redis.set(`sso:${state}`, JSON.stringify(entry), 'PX', ttlMs);
  }

  async take(state: string): Promise<SsoStateEntry | null> {
    const raw = await this.redis.getdel(`sso:${state}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SsoStateEntry;
    } catch {
      // Corrupt/foreign value under our key: treat as no pending transaction. Deliberately no
      // logging — the payload is transaction-secret material.
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
