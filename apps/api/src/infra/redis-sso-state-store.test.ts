import type { SsoStateEntry } from '@gilgamesh/application';
import { describe, expect, it } from 'vitest';
import { RedisSsoStateStore, type RedisSsoClient } from './redis-sso-state-store';

const ENTRY: SsoStateEntry = { nonce: 'n-1', codeVerifier: 'v-1', redirect: 'https://app.test/cb' };

/**
 * In-process fake of the minimal ioredis surface the adapter uses (the `SmtpTransport` seam
 * idiom). `getdel` deletes-and-returns atomically like real Redis, so the single-use claim
 * semantics are exercised without a server.
 */
class FakeRedis implements RedisSsoClient {
  readonly data = new Map<string, string>();
  readonly setCalls: Array<{ key: string; value: string; px: string; ttlMs: number }> = [];
  readonly getdelCalls: string[] = [];
  quitCount = 0;

  async set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown> {
    this.setCalls.push({ key, value, px, ttlMs });
    this.data.set(key, value);
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    this.getdelCalls.push(key);
    const value = this.data.get(key) ?? null;
    this.data.delete(key);
    return value;
  }

  async quit(): Promise<unknown> {
    this.quitCount += 1;
    return 'OK';
  }
}

function makeStore(): { store: RedisSsoStateStore; redis: FakeRedis } {
  const redis = new FakeRedis();
  const store = new RedisSsoStateStore('redis://fake:6379', () => redis);
  return { store, redis };
}

describe('RedisSsoStateStore', () => {
  it('put stores the JSON-serialized entry under a prefixed key with a native PX TTL', async () => {
    const { store, redis } = makeStore();
    await store.put('s-1', ENTRY, 600_000);
    expect(redis.setCalls).toEqual([
      { key: 'sso:s-1', value: JSON.stringify(ENTRY), px: 'PX', ttlMs: 600_000 },
    ]);
  });

  it('take claims via a single GETDEL and round-trips the entry', async () => {
    const { store, redis } = makeStore();
    await store.put('s-1', ENTRY, 600_000);
    expect(await store.take('s-1')).toEqual(ENTRY);
    expect(redis.getdelCalls).toEqual(['sso:s-1']);
  });

  it('is single-use: the second take of the same state is null', async () => {
    const { store } = makeStore();
    await store.put('s-1', ENTRY, 600_000);
    expect(await store.take('s-1')).toEqual(ENTRY);
    expect(await store.take('s-1')).toBeNull();
  });

  it('returns null for an unknown (or natively-expired) state', async () => {
    const { store } = makeStore();
    expect(await store.take('never-stored')).toBeNull();
  });

  it('keeps states isolated: taking one state never consumes another', async () => {
    const { store } = makeStore();
    await store.put('s-1', ENTRY, 600_000);
    await store.put('s-2', { ...ENTRY, nonce: 'n-2' }, 600_000);
    expect(await store.take('s-1')).toEqual(ENTRY);
    expect(await store.take('s-2')).toEqual({ ...ENTRY, nonce: 'n-2' });
  });

  it('returns null (never throws) on a corrupt stored value', async () => {
    const { store, redis } = makeStore();
    redis.data.set('sso:s-1', 'not json');
    expect(await store.take('s-1')).toBeNull();
  });

  it('builds the client from the URL via the injected factory', () => {
    let seenUrl: string | undefined;
    const redis = new FakeRedis();
    void new RedisSsoStateStore('redis://somewhere:6379', (url) => {
      seenUrl = url;
      return redis;
    });
    expect(seenUrl).toBe('redis://somewhere:6379');
  });

  it('quits the client on module destroy', async () => {
    const { store, redis } = makeStore();
    await store.onModuleDestroy();
    expect(redis.quitCount).toBe(1);
  });
});
