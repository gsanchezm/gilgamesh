import { describe, expect, it } from 'vitest';
import { lockedUntilFor } from './backoff';

const cfg = { threshold: 10, baseMs: 60_000, maxMs: 900_000 };

describe('lockedUntilFor', () => {
  it('does not lock below the threshold', () => {
    expect(lockedUntilFor(0, cfg, 1_000)).toBeNull();
    expect(lockedUntilFor(9, cfg, 1_000)).toBeNull();
  });

  it('locks for the base window exactly at the threshold', () => {
    expect(lockedUntilFor(10, cfg, 1_000)).toBe(1_000 + 60_000);
  });

  it('doubles the window per extra failure', () => {
    expect(lockedUntilFor(11, cfg, 1_000)).toBe(1_000 + 120_000);
    expect(lockedUntilFor(12, cfg, 1_000)).toBe(1_000 + 240_000);
    expect(lockedUntilFor(13, cfg, 1_000)).toBe(1_000 + 480_000);
  });

  it('caps the window at maxMs', () => {
    // base*2^4 = 960_000 > maxMs 900_000 -> capped
    expect(lockedUntilFor(14, cfg, 1_000)).toBe(1_000 + 900_000);
    expect(lockedUntilFor(100, cfg, 1_000)).toBe(1_000 + 900_000);
  });
});
