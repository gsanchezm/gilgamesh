import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

// The default suite raises AUTH_RATE_LIMIT sky-high so sweeps never trip the guard; this file
// deliberately lowers it to exercise the 429 branch, then restores the env afterwards.
const ORIGINAL_LIMIT = process.env.AUTH_RATE_LIMIT;
const ORIGINAL_WINDOW = process.env.AUTH_RATE_WINDOW_MS;
const ORIGINAL_REDIS = process.env.REDIS_URL;
const LIMIT = 3;

let app: INestApplication;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = String(LIMIT);
  process.env.AUTH_RATE_WINDOW_MS = '60000';
  // Pin the in-memory store regardless of ambient env, so a shell-wide REDIS_URL can't make this
  // suite non-hermetic (a Redis-backed re-run within the window would pre-throttle the assertions).
  delete process.env.REDIS_URL;
  // The RATE_LIMIT provider reads the env at module-compile time, so set it before compiling.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  if (ORIGINAL_LIMIT === undefined) delete process.env.AUTH_RATE_LIMIT;
  else process.env.AUTH_RATE_LIMIT = ORIGINAL_LIMIT;
  if (ORIGINAL_WINDOW === undefined) delete process.env.AUTH_RATE_WINDOW_MS;
  else process.env.AUTH_RATE_WINDOW_MS = ORIGINAL_WINDOW;
  if (ORIGINAL_REDIS === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS;
});

const login = (email: string) =>
  request(app.getHttpServer()).post('/auth/login').send({ email, password: 'wrong-Password1' });

describe('Auth rate limiting (AC-AUTH-13)', () => {
  it('allows up to the limit, then returns 429 RATE_LIMITED with Retry-After + X-RateLimit headers', async () => {
    const email = 'throttled@example.com';

    for (let i = 1; i <= LIMIT; i++) {
      const res = await login(email);
      expect(res.status).not.toBe(429); // invalid creds (401), but not throttled yet
      expect(res.headers['x-ratelimit-limit']).toBe(String(LIMIT));
    }

    const blocked = await login(email);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('keys the window per account, so a different email is not throttled', async () => {
    const other = 'fresh-account@example.com';
    for (let i = 1; i <= LIMIT; i++) {
      const res = await login(other);
      expect(res.status).not.toBe(429);
    }
  });

  it('treats whitespace-padded emails as the same bucket (no padding bypass)', async () => {
    const canonical = 'pad-victim@example.com';
    for (let i = 1; i <= LIMIT; i++) {
      const res = await login(canonical);
      expect(res.status).not.toBe(429);
    }
    // A padded variant resolves to the same account at the auth layer, so it must NOT get a fresh
    // bucket — otherwise the throttle is trivially bypassable.
    const padded = await login(`  ${canonical} `);
    expect(padded.status).toBe(429);
  });
});
