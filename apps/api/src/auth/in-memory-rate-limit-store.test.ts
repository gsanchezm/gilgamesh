import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store';

/** A mutable fake clock so window expiry is deterministic. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    clock: { now: () => new Date(t) },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('InMemoryRateLimitStore', () => {
  it('increments the count on each hit within the window', async () => {
    const { clock } = fakeClock();
    const store = new InMemoryRateLimitStore(clock);

    expect((await store.hit('k', 60_000)).count).toBe(1);
    expect((await store.hit('k', 60_000)).count).toBe(2);
    expect((await store.hit('k', 60_000)).count).toBe(3);
  });

  it('keeps a stable resetAt for the duration of a window', async () => {
    const { clock } = fakeClock(1_000_000);
    const store = new InMemoryRateLimitStore(clock);

    const first = await store.hit('k', 60_000);
    const second = await store.hit('k', 60_000);

    expect(first.resetAt).toBe(1_060_000);
    expect(second.resetAt).toBe(first.resetAt);
  });

  it('starts a fresh window once the previous one has elapsed', async () => {
    const { clock, advance } = fakeClock(1_000_000);
    const store = new InMemoryRateLimitStore(clock);

    await store.hit('k', 60_000);
    await store.hit('k', 60_000);
    advance(60_000); // reach the window boundary

    const fresh = await store.hit('k', 60_000);
    expect(fresh.count).toBe(1);
    expect(fresh.resetAt).toBe(1_120_000);
  });

  it('tracks distinct keys independently', async () => {
    const { clock } = fakeClock();
    const store = new InMemoryRateLimitStore(clock);

    await store.hit('a', 60_000);
    await store.hit('a', 60_000);

    expect((await store.hit('b', 60_000)).count).toBe(1);
  });
});
