import type { Clock } from '@gilgamesh/application';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { RateLimitHit, RateLimitStore } from './rate-limit-store';

// Atomic counter+window in one round trip: INCR, set the TTL only when the window is created
// (count === 1), then read the remaining TTL. Avoids the incr/expire race and self-evicts via
// native Redis TTL — no unbounded key growth.
const HIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/**
 * Redis-backed fixed-window store for multi-replica deployments. Counting + window expiry are a
 * single atomic Lua script (INCR, then PEXPIRE only on the first hit, then read PTTL) so there is
 * no incr/expire race and the key self-evicts via native TTL — no unbounded memory growth.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly clock: Clock,
  ) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3 });
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const redisKey = `rl:${key}`;
    const [count, ttl] = (await this.redis.eval(HIT_LUA, 1, redisKey, String(windowMs))) as [
      number,
      number,
    ];
    const remainingMs = ttl >= 0 ? ttl : windowMs;
    return { count, resetAt: this.clock.now().getTime() + remainingMs };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
