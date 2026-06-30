import type { Clock } from '@gilgamesh/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisRateLimitStore } from '../../src/auth/redis-rate-limit-store';

// Real Redis (docker compose up -d redis). Each test uses a unique key so runs don't contaminate.
const URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const clock: Clock = { now: () => new Date() };
let store: RedisRateLimitStore;

beforeAll(() => {
  store = new RedisRateLimitStore(URL, clock);
});

afterAll(async () => {
  await store.onModuleDestroy();
});

describe('RedisRateLimitStore (real Redis)', () => {
  it('increments the count across hits within the window', async () => {
    const key = `test:incr:${Date.now()}`;
    expect((await store.hit(key, 60_000)).count).toBe(1);
    expect((await store.hit(key, 60_000)).count).toBe(2);
    expect((await store.hit(key, 60_000)).count).toBe(3);
  });

  it('reports a resetAt inside the window', async () => {
    const key = `test:reset:${Date.now()}`;
    const before = Date.now();
    const hit = await store.hit(key, 60_000);
    const after = Date.now();
    // resetAt = (a clock reading between before and after) + ttl, ttl <= windowMs — so this upper
    // bound holds with zero latency-dependent slack.
    expect(hit.resetAt).toBeGreaterThan(before);
    expect(hit.resetAt).toBeLessThanOrEqual(after + 60_000);
  });

  it('expires the window via native TTL, resetting the count', async () => {
    const key = `test:ttl:${Date.now()}`;
    await store.hit(key, 200); // 200ms window
    await store.hit(key, 200);
    await new Promise((resolve) => setTimeout(resolve, 300)); // wait past the TTL
    expect((await store.hit(key, 200)).count).toBe(1);
  });
});
