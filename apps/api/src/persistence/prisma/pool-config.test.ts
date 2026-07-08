import { describe, expect, it, vi } from 'vitest';
import {
  connectWithRetry,
  DEFAULT_POOL_DEFAULTS,
  poolDefaultsFromEnv,
  withPoolDefaults,
} from './pool-config';

const BASE = 'postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public';

describe('withPoolDefaults', () => {
  it('appends all three pool params when absent (AC-DBP-01a)', () => {
    const out = new URL(withPoolDefaults(BASE)!);
    expect(out.searchParams.get('connection_limit')).toBe('5');
    expect(out.searchParams.get('pool_timeout')).toBe('10');
    expect(out.searchParams.get('connect_timeout')).toBe('10');
  });

  it('preserves the original host / db / user / sslmode and keeps parsing (AC-DBP-01d)', () => {
    const src = 'postgresql://usr:p%40ss@db.example.com:6543/appdb?sslmode=require';
    const out = new URL(withPoolDefaults(src)!);
    expect(out.username).toBe('usr');
    expect(out.password).toBe('p%40ss'); // not double-encoded
    expect(out.hostname).toBe('db.example.com');
    expect(out.port).toBe('6543');
    expect(out.pathname).toBe('/appdb');
    expect(out.searchParams.get('sslmode')).toBe('require');
  });

  it('handles a DSN with no query string at all', () => {
    const out = new URL(withPoolDefaults('postgresql://u:p@h:5432/db')!);
    expect(out.searchParams.get('connection_limit')).toBe('5');
    expect(out.searchParams.get('pool_timeout')).toBe('10');
    expect(out.searchParams.get('connect_timeout')).toBe('10');
    expect(out.pathname).toBe('/db');
  });

  it('augments both the postgres:// and postgresql:// schemes', () => {
    for (const scheme of ['postgres', 'postgresql']) {
      const out = new URL(withPoolDefaults(`${scheme}://u:p@h:5432/db`)!);
      expect(out.searchParams.get('connection_limit')).toBe('5');
    }
  });

  // --- never override an operator-set value (AC-DBP-01a: absent-only), each param independently ---

  it('preserves an operator-set connection_limit', () => {
    const out = new URL(withPoolDefaults(`${BASE}&connection_limit=17`)!);
    expect(out.searchParams.get('connection_limit')).toBe('17'); // untouched
    expect(out.searchParams.get('pool_timeout')).toBe('10'); // still added
    expect(out.searchParams.get('connect_timeout')).toBe('10');
  });

  it('preserves an operator-set pool_timeout', () => {
    const out = new URL(withPoolDefaults(`${BASE}&pool_timeout=45`)!);
    expect(out.searchParams.get('pool_timeout')).toBe('45'); // untouched
    expect(out.searchParams.get('connection_limit')).toBe('5');
    expect(out.searchParams.get('connect_timeout')).toBe('10');
  });

  it('preserves an operator-set connect_timeout', () => {
    const out = new URL(withPoolDefaults(`${BASE}&connect_timeout=30`)!);
    expect(out.searchParams.get('connect_timeout')).toBe('30'); // untouched
    expect(out.searchParams.get('connection_limit')).toBe('5');
    expect(out.searchParams.get('pool_timeout')).toBe('10');
  });

  it('preserves all three when the operator set all three (adds nothing)', () => {
    const src = `${BASE}&connection_limit=1&pool_timeout=1&connect_timeout=1`;
    const out = new URL(withPoolDefaults(src)!);
    expect(out.searchParams.get('connection_limit')).toBe('1');
    expect(out.searchParams.get('pool_timeout')).toBe('1');
    expect(out.searchParams.get('connect_timeout')).toBe('1');
  });

  it('honors custom opts values', () => {
    const out = new URL(
      withPoolDefaults(BASE, { connectionLimit: 8, poolTimeoutS: 20, connectTimeoutS: 15 })!,
    );
    expect(out.searchParams.get('connection_limit')).toBe('8');
    expect(out.searchParams.get('pool_timeout')).toBe('20');
    expect(out.searchParams.get('connect_timeout')).toBe('15');
  });

  // --- safe on non-postgres / malformed / empty (AC-DBP-01b: returned unchanged, never throws) ---

  it('returns a non-postgres URL unchanged', () => {
    expect(withPoolDefaults('mysql://u:p@h/db')).toBe('mysql://u:p@h/db');
    expect(withPoolDefaults('file:./dev.db')).toBe('file:./dev.db');
  });

  it('returns a malformed URL unchanged (no throw that breaks boot)', () => {
    expect(withPoolDefaults('not a url')).toBe('not a url');
    expect(withPoolDefaults('::::')).toBe('::::');
  });

  it('returns undefined / empty unchanged', () => {
    expect(withPoolDefaults(undefined)).toBeUndefined();
    expect(withPoolDefaults('')).toBe('');
  });
});

describe('poolDefaultsFromEnv (AC-DBP-01c)', () => {
  it('returns the sane defaults when no env is set', () => {
    expect(poolDefaultsFromEnv({})).toEqual(DEFAULT_POOL_DEFAULTS);
  });

  it('honors each env override independently', () => {
    expect(
      poolDefaultsFromEnv({
        DB_CONNECTION_LIMIT: '9',
        DB_POOL_TIMEOUT_S: '20',
        DB_CONNECT_TIMEOUT_S: '15',
      }),
    ).toEqual({ connectionLimit: 9, poolTimeoutS: 20, connectTimeoutS: 15 });
  });

  it('falls back to the default on a non-positive or non-integer override', () => {
    expect(poolDefaultsFromEnv({ DB_CONNECTION_LIMIT: '0' }).connectionLimit).toBe(5);
    expect(poolDefaultsFromEnv({ DB_CONNECTION_LIMIT: '-3' }).connectionLimit).toBe(5);
    expect(poolDefaultsFromEnv({ DB_POOL_TIMEOUT_S: 'abc' }).poolTimeoutS).toBe(10);
    expect(poolDefaultsFromEnv({ DB_CONNECT_TIMEOUT_S: '1.5' }).connectTimeoutS).toBe(10);
  });

  it('composes with withPoolDefaults end-to-end', () => {
    const opts = poolDefaultsFromEnv({ DB_CONNECTION_LIMIT: '3' });
    const out = new URL(withPoolDefaults(BASE, opts)!);
    expect(out.searchParams.get('connection_limit')).toBe('3');
    expect(out.searchParams.get('pool_timeout')).toBe('10');
  });
});

describe('connectWithRetry', () => {
  it('connects on the first attempt without sleeping', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await connectWithRetry(connect, { sleep });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure then succeeds (cold-wake path)', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    await connectWithRetry(connect, { sleep, onRetry });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(500); // linear backoff, first gap
    expect(onRetry).toHaveBeenCalledWith(1, 500); // detail-free: attempt + delay, no error
  });

  it('rethrows the LAST error after exhausting retries — never swallowed', async () => {
    const boom = new Error('db still down');
    const connect = vi.fn().mockRejectedValue(boom);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(connectWithRetry(connect, { retries: 2, sleep })).rejects.toBe(boom);
    expect(connect).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2); // between the three attempts
  });

  it('uses linear backoff across multiple retries', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(connectWithRetry(connect, { retries: 2, backoffMs: 500, sleep })).rejects.toThrow();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });
});
