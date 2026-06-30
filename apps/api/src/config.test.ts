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

  it('throws when REDIS_URL is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
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
