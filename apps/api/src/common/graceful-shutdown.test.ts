import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from './graceful-shutdown';

/**
 * Slice 29 — the SIGTERM drain sequence, unit-tested with an injected fake timer + spies so the
 * grace window and idempotency are asserted deterministically, without real signals or wall-clock.
 */

/** A fake setTimeout that captures the scheduled callback + delay for manual, synchronous firing. */
function fakeTimer() {
  const scheduled: { cb: () => void; ms: number }[] = [];
  const setTimeoutFn = (cb: () => void, ms: number): unknown => {
    scheduled.push({ cb, ms });
    return scheduled.length; // a truthy handle
  };
  return {
    setTimeoutFn,
    count: () => scheduled.length,
    lastDelay: () => scheduled.at(-1)?.ms,
    fireAll: () => scheduled.forEach((s) => s.cb()),
  };
}

describe('createShutdownHandler', () => {
  it('AC-SHUT-04: begins draining synchronously and does NOT close before the grace elapses', () => {
    const timer = fakeTimer();
    const beginDraining = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);

    const handler = createShutdownHandler({
      beginDraining,
      close,
      graceMs: 10_000,
      setTimeoutFn: timer.setTimeoutFn,
    });

    handler();

    expect(beginDraining).toHaveBeenCalledTimes(1); // readiness flips to 503 immediately
    expect(close).not.toHaveBeenCalled(); // still serving during the grace window
    expect(timer.count()).toBe(1);
    expect(timer.lastDelay()).toBe(10_000);
  });

  it('AC-SHUT-04: closes exactly once after the grace period, then calls onClosed', async () => {
    const timer = fakeTimer();
    const beginDraining = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const onClosed = vi.fn();

    const handler = createShutdownHandler({
      beginDraining,
      close,
      graceMs: 5_000,
      setTimeoutFn: timer.setTimeoutFn,
      onClosed,
    });

    handler();
    timer.fireAll();
    await Promise.resolve(); // let the close() promise settle

    expect(close).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('AC-SHUT-04: is idempotent — a second SIGTERM during the grace window is a no-op', () => {
    const timer = fakeTimer();
    const beginDraining = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);

    const handler = createShutdownHandler({
      beginDraining,
      close,
      graceMs: 10_000,
      setTimeoutFn: timer.setTimeoutFn,
    });

    handler();
    handler(); // second SIGTERM
    handler();

    expect(beginDraining).toHaveBeenCalledTimes(1); // no double-drain
    expect(timer.count()).toBe(1); // no second close scheduled
  });

  it('routes a close() failure to onError (never left unhandled)', async () => {
    const timer = fakeTimer();
    const boom = new Error('close failed');
    const onError = vi.fn();

    const handler = createShutdownHandler({
      beginDraining: vi.fn(),
      close: vi.fn().mockRejectedValue(boom),
      graceMs: 1_000,
      setTimeoutFn: timer.setTimeoutFn,
      onError,
    });

    handler();
    timer.fireAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(boom);
  });
});
