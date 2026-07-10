import type { Clock } from '@gilgamesh/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IpLockoutConfig } from '../../src/config';
import { RedisLoginAttemptStore } from '../../src/auth/redis-login-attempt-store';

// Real Redis (docker compose up -d redis). Unique keys per test so runs don't contaminate.
const URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const clock: Clock = { now: () => new Date() };
const cfg: IpLockoutConfig = {
  ipLimit: 30,
  ipWindowMs: 60_000,
  threshold: 2,
  baseMs: 1_000,
  maxMs: 300, // short retention so the TTL-eviction test is fast
};
let store: RedisLoginAttemptStore;

beforeAll(() => {
  store = new RedisLoginAttemptStore(URL, clock, cfg);
});

afterAll(async () => {
  await store.onModuleDestroy();
});

describe('RedisLoginAttemptStore (real Redis)', () => {
  it('counts failures and locks once the threshold is reached', async () => {
    const key = `test:lock:${Date.now()}`;
    const now = Date.now();
    expect((await store.recordFailure(key, now)).lockedUntil).toBeNull(); // failures = 1 < 2
    const second = await store.recordFailure(key, now);
    expect(second.failures).toBe(2);
    expect(second.lockedUntil).toBe(now + cfg.baseMs); // failures = 2 = threshold
    expect((await store.getState(key)).lockedUntil).toBe(now + cfg.baseMs);
  });

  it('clears the counter', async () => {
    const key = `test:clear:${Date.now()}`;
    await store.recordFailure(key, Date.now());
    await store.clear(key);
    expect(await store.getState(key)).toEqual({ failures: 0, lockedUntil: null });
  });

  it('evicts the record via native TTL (retention window)', async () => {
    const key = `test:ttl:${Date.now()}`;
    await store.recordFailure(key, Date.now());
    await new Promise((resolve) => setTimeout(resolve, cfg.maxMs + 150)); // wait past retention
    expect(await store.getState(key)).toEqual({ failures: 0, lockedUntil: null });
  });
});
