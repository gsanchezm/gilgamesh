import { describe, expect, it } from 'vitest';
import { loadConfig, rateLimitFromEnv } from './config';

const base = {
  DATABASE_URL: 'postgresql://gilgamesh@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('parses a valid env with sensible defaults', () => {
    const c = loadConfig(base);
    expect(c.databaseUrl).toBe(base.DATABASE_URL);
    expect(c.redisUrl).toBe(base.REDIS_URL);
    expect(c.port).toBe(3001);
    expect(c.corsOrigins).toEqual([]);
    expect(c.nodeEnv).toBe('development');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ REDIS_URL: base.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('leaves redisUrl undefined when REDIS_URL is absent (in-memory stores, single-replica only)', () => {
    expect(loadConfig({ DATABASE_URL: base.DATABASE_URL }).redisUrl).toBeUndefined();
    expect(loadConfig({ DATABASE_URL: base.DATABASE_URL, REDIS_URL: '   ' }).redisUrl).toBeUndefined();
  });

  it('parses CORS_ORIGINS as a trimmed comma list', () => {
    expect(loadConfig({ ...base, CORS_ORIGINS: 'https://a.com, https://b.com' }).corsOrigins).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('rejects a non-numeric API_PORT', () => {
    expect(() => loadConfig({ ...base, API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('honors NODE_ENV and a custom API_PORT', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', API_PORT: '8080' });
    expect(c.nodeEnv).toBe('production');
    expect(c.port).toBe(8080);
  });

  it('includes the rate-limit config', () => {
    expect(loadConfig({ ...base, AUTH_RATE_LIMIT: '7' }).rateLimit).toEqual({ limit: 7, windowMs: 60_000 });
  });

  it('defaults trustProxy to 1 and reads TRUST_PROXY', () => {
    expect(loadConfig(base).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(0);
  });

  it('rejects a negative or non-integer TRUST_PROXY', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'abc' })).toThrow(/TRUST_PROXY/);
  });

  it('parses WEB_DIST_DIR trimmed, undefined when absent or blank', () => {
    expect(loadConfig({ ...base, WEB_DIST_DIR: '  /app/apps/web/dist  ' }).webDistDir).toBe(
      '/app/apps/web/dist',
    );
    expect(loadConfig(base).webDistDir).toBeUndefined();
    expect(loadConfig({ ...base, WEB_DIST_DIR: '   ' }).webDistDir).toBeUndefined();
  });

  it('defaults shutdownGraceMs to 10s and reads SHUTDOWN_GRACE_MS (slice 29)', () => {
    expect(loadConfig(base).shutdownGraceMs).toBe(10_000);
    expect(loadConfig({ ...base, SHUTDOWN_GRACE_MS: '3000' }).shutdownGraceMs).toBe(3000);
    expect(loadConfig({ ...base, SHUTDOWN_GRACE_MS: '0' }).shutdownGraceMs).toBe(0);
  });

  it('rejects a negative or non-integer SHUTDOWN_GRACE_MS', () => {
    expect(() => loadConfig({ ...base, SHUTDOWN_GRACE_MS: '-1' })).toThrow(/SHUTDOWN_GRACE_MS/);
    expect(() => loadConfig({ ...base, SHUTDOWN_GRACE_MS: 'abc' })).toThrow(/SHUTDOWN_GRACE_MS/);
    expect(() => loadConfig({ ...base, SHUTDOWN_GRACE_MS: '1.5' })).toThrow(/SHUTDOWN_GRACE_MS/);
  });

  it('defaults logFormat to "pretty" and selects "json" only for LOG_FORMAT=json (slice 30)', () => {
    expect(loadConfig(base).logFormat).toBe('pretty');
    expect(loadConfig({ ...base, LOG_FORMAT: 'json' }).logFormat).toBe('json');
    expect(loadConfig({ ...base, LOG_FORMAT: '  JSON  ' }).logFormat).toBe('json'); // trimmed + case-insensitive
    expect(loadConfig({ ...base, LOG_FORMAT: 'pretty' }).logFormat).toBe('pretty');
  });

  it('falls back to "pretty" for an unrecognised LOG_FORMAT (fail-safe, never silently unknown)', () => {
    expect(loadConfig({ ...base, LOG_FORMAT: 'xml' }).logFormat).toBe('pretty');
    expect(loadConfig({ ...base, LOG_FORMAT: '' }).logFormat).toBe('pretty');
    expect(loadConfig({ ...base, LOG_FORMAT: '   ' }).logFormat).toBe('pretty');
  });
});

describe('rateLimitFromEnv', () => {
  it('defaults to 10 requests per 60s when unset', () => {
    expect(rateLimitFromEnv({})).toEqual({ limit: 10, windowMs: 60_000 });
  });

  it('reads AUTH_RATE_LIMIT and AUTH_RATE_WINDOW_MS', () => {
    expect(rateLimitFromEnv({ AUTH_RATE_LIMIT: '3', AUTH_RATE_WINDOW_MS: '1000' })).toEqual({
      limit: 3,
      windowMs: 1000,
    });
  });

  it('falls back to defaults for zero, negative, or non-integer values', () => {
    expect(rateLimitFromEnv({ AUTH_RATE_LIMIT: '0' }).limit).toBe(10);
    expect(rateLimitFromEnv({ AUTH_RATE_LIMIT: '-5' }).limit).toBe(10);
    expect(rateLimitFromEnv({ AUTH_RATE_LIMIT: 'abc' }).limit).toBe(10);
    expect(rateLimitFromEnv({ AUTH_RATE_WINDOW_MS: '1.5' }).windowMs).toBe(60_000);
  });
});
