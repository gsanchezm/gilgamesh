import type { SsoStateEntry } from '@gilgamesh/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisSsoStateStore } from '../../src/infra/redis-sso-state-store';

// Real Redis (docker compose up -d redis). Each test uses a unique state so runs don't contaminate.
const URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ENTRY: SsoStateEntry = { nonce: 'n-1', codeVerifier: 'v-1', redirect: 'https://app.test/cb' };
let store: RedisSsoStateStore;

beforeAll(() => {
  store = new RedisSsoStateStore(URL);
});

afterAll(async () => {
  await store.onModuleDestroy();
});

describe('RedisSsoStateStore (real Redis)', () => {
  it('round-trips a stored entry', async () => {
    const state = `test:sso:roundtrip:${Date.now()}`;
    await store.put(state, ENTRY, 600_000);
    expect(await store.take(state)).toEqual(ENTRY);
  });

  it('is single-use even under concurrent claims (atomic GETDEL)', async () => {
    const state = `test:sso:race:${Date.now()}`;
    await store.put(state, ENTRY, 600_000);
    // Two callbacks racing on the same state: exactly ONE may win.
    const [first, second] = await Promise.all([store.take(state), store.take(state)]);
    const winners = [first, second].filter((r) => r !== null);
    expect(winners).toEqual([ENTRY]);
    // And a later replay finds nothing.
    expect(await store.take(state)).toBeNull();
  });

  it('returns null for an unknown state', async () => {
    expect(await store.take(`test:sso:unknown:${Date.now()}`)).toBeNull();
  });

  it('expires the state via native TTL', async () => {
    const state = `test:sso:ttl:${Date.now()}`;
    await store.put(state, ENTRY, 200); // 200ms TTL
    await new Promise((resolve) => setTimeout(resolve, 300)); // wait past the TTL
    expect(await store.take(state)).toBeNull();
  });
});
