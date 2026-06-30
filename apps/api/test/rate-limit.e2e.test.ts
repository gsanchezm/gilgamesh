import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

// The default suite raises AUTH_RATE_LIMIT sky-high so sweeps never trip the guard; this file
// deliberately lowers it to exercise the 429 branch, then restores the env afterwards.
const ORIGINAL_LIMIT = process.env.AUTH_RATE_LIMIT;
const ORIGINAL_WINDOW = process.env.AUTH_RATE_WINDOW_MS;
const LIMIT = 3;

let app: INestApplication;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = String(LIMIT);
  process.env.AUTH_RATE_WINDOW_MS = '60000';
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
});
