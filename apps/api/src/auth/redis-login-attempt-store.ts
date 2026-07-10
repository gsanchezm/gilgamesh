import type { Clock } from '@gilgamesh/application';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { IpLockoutConfig } from '../config';
import type { LoginAttemptState, LoginAttemptStore } from './login-attempt-store';

// Atomic failure record: HINCRBY the counter, and only once it reaches the threshold compute+store
// the lock instant (base * 2^(failures-threshold), capped at maxMs); PEXPIRE rolls the retention
// window forward on every failure so the escalating counter survives across lock cycles and
// self-evicts when the attacker gives up. Returns {failures, lockedUntil-or-empty}.
const RECORD_LUA = `
local failures = redis.call('HINCRBY', KEYS[1], 'failures', 1)
local threshold = tonumber(ARGV[1])
local lockedUntil = ''
if failures >= threshold then
  local dur = math.min(tonumber(ARGV[3]), tonumber(ARGV[2]) * (2 ^ (failures - threshold)))
  lockedUntil = tostring(tonumber(ARGV[4]) + dur)
  redis.call('HSET', KEYS[1], 'lockedUntil', lockedUntil)
end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
return {failures, lockedUntil}
`;

const STATE_LUA = `
local failures = redis.call('HGET', KEYS[1], 'failures')
local lockedUntil = redis.call('HGET', KEYS[1], 'lockedUntil')
return {failures or '0', lockedUntil or ''}
`;

/**
 * Redis-backed per-IP failure lockout for multi-replica deployments. The record is a HASH with
 * native TTL eviction (no unbounded key growth); the increment + lock computation are one atomic
 * Lua script (no read-modify-write race between concurrent failed attempts).
 */
@Injectable()
export class RedisLoginAttemptStore implements LoginAttemptStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly clock: Clock,
    private readonly cfg: IpLockoutConfig,
  ) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3 });
  }

  async recordFailure(key: string, now: number): Promise<LoginAttemptState> {
    const [failures, lockedUntil] = (await this.redis.eval(
      RECORD_LUA,
      1,
      `la:${key}`,
      String(this.cfg.threshold),
      String(this.cfg.baseMs),
      String(this.cfg.maxMs),
      String(now),
      String(this.cfg.maxMs),
    )) as [number, string];
    return { failures: Number(failures), lockedUntil: lockedUntil ? Number(lockedUntil) : null };
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(`la:${key}`);
  }

  async getState(key: string): Promise<LoginAttemptState> {
    const [failures, lockedUntil] = (await this.redis.eval(STATE_LUA, 1, `la:${key}`)) as [
      string,
      string,
    ];
    return { failures: Number(failures), lockedUntil: lockedUntil ? Number(lockedUntil) : null };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
