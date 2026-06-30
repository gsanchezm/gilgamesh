import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgresql://gilgamesh@localhost:5432/db' };

describe('loadConfig', () => {
  it('parses a valid env with sensible defaults', () => {
    const c = loadConfig(base);
    expect(c.databaseUrl).toBe(base.DATABASE_URL);
    expect(c.port).toBe(3001);
    expect(c.corsOrigins).toEqual([]);
    expect(c.nodeEnv).toBe('development');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
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
});
