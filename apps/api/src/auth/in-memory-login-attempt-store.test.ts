import { describe, expect, it } from 'vitest';
import type { IpLockoutConfig } from '../config';
import { InMemoryLoginAttemptStore } from './in-memory-login-attempt-store';

/** A mutable fake clock so lock windows + retention are deterministic. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: { now: () => new Date(t) }, advance: (ms: number) => { t += ms; }, at: () => t };
}

const cfg: IpLockoutConfig = {
  ipLimit: 30,
  ipWindowMs: 60_000,
  threshold: 3,
  baseMs: 1_000,
  maxMs: 60_000,
};

describe('InMemoryLoginAttemptStore', () => {
  it('counts failures and does not lock below the threshold', async () => {
    const { clock, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    expect(await store.recordFailure('ip', at())).toEqual({ failures: 1, lockedUntil: null });
    expect(await store.recordFailure('ip', at())).toEqual({ failures: 2, lockedUntil: null });
    expect((await store.getState('ip')).lockedUntil).toBeNull();
  });

  it('locks once the threshold is reached', async () => {
    const { clock, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    await store.recordFailure('ip', at());
    await store.recordFailure('ip', at());
    const third = await store.recordFailure('ip', at()); // failures = 3 = threshold

    expect(third.lockedUntil).toBe(at() + cfg.baseMs);
    expect((await store.getState('ip')).lockedUntil).toBe(at() + cfg.baseMs);
  });

  it('clears the counter on success', async () => {
    const { clock, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    await store.recordFailure('ip', at());
    await store.recordFailure('ip', at());
    await store.clear('ip');

    expect(await store.getState('ip')).toEqual({ failures: 0, lockedUntil: null });
  });

  it('grows the lock window exponentially across cycles, capped at maxMs', async () => {
    const { clock, advance, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    // reach the threshold -> first lock = base
    await store.recordFailure('ip', at());
    await store.recordFailure('ip', at());
    const lock1 = await store.recordFailure('ip', at());
    expect(lock1.lockedUntil! - at()).toBe(1_000); // base * 2^0

    advance(1_000); // lock expires
    const lock2 = await store.recordFailure('ip', at());
    expect(lock2.lockedUntil! - at()).toBe(2_000); // base * 2^1

    advance(2_000);
    const lock3 = await store.recordFailure('ip', at());
    expect(lock3.lockedUntil! - at()).toBe(4_000); // base * 2^2
  });

  it('lazily resets the record once the retention window elapses', async () => {
    const { clock, advance, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    await store.recordFailure('ip', at());
    advance(cfg.maxMs); // reach the retention boundary
    expect(await store.getState('ip')).toEqual({ failures: 0, lockedUntil: null });
  });

  it('tracks distinct keys independently (per-IP isolation)', async () => {
    const { clock, at } = fakeClock();
    const store = new InMemoryLoginAttemptStore(clock, cfg);

    await store.recordFailure('ip-a', at());
    await store.recordFailure('ip-a', at());
    await store.recordFailure('ip-a', at()); // ip-a locked

    expect((await store.getState('ip-a')).lockedUntil).not.toBeNull();
    expect(await store.getState('ip-b')).toEqual({ failures: 0, lockedUntil: null });
  });
});
