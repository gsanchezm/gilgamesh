import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

// Slice 39. The general sweep neutralizes the per-IP guard (vitest.config env); this file lowers
// the knobs to exercise the ceiling (A1) + failure lockout (A2), and raises the per-account
// AUTH_RATE_LIMIT so RateLimitGuard never interferes with the assertions. trust proxy + a per-test
// X-Forwarded-For give each scenario its own client IP (the abuse key), so tests don't contaminate.
const SAVED = {
  rate: process.env.AUTH_RATE_LIMIT,
  ipRate: process.env.AUTH_IP_RATE_LIMIT,
  threshold: process.env.AUTH_LOCKOUT_THRESHOLD,
  base: process.env.AUTH_LOCKOUT_BASE_MS,
  max: process.env.AUTH_LOCKOUT_MAX_MS,
  redis: process.env.REDIS_URL,
};

const IP_LIMIT = 20;
const THRESHOLD = 3;
let app: INestApplication;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = '1000000'; // isolate: only the per-IP guard should fire here
  process.env.AUTH_IP_RATE_LIMIT = String(IP_LIMIT);
  process.env.AUTH_LOCKOUT_THRESHOLD = String(THRESHOLD);
  process.env.AUTH_LOCKOUT_BASE_MS = '1000';
  process.env.AUTH_LOCKOUT_MAX_MS = '2000';
  delete process.env.REDIS_URL; // pin the in-memory stores regardless of ambient env
  // Config providers read env at module-compile time, so set it before compiling.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // Honor X-Forwarded-For so each test can present a distinct client IP.
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.init();
});

afterAll(async () => {
  await app.close();
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  restore('AUTH_RATE_LIMIT', SAVED.rate);
  restore('AUTH_IP_RATE_LIMIT', SAVED.ipRate);
  restore('AUTH_LOCKOUT_THRESHOLD', SAVED.threshold);
  restore('AUTH_LOCKOUT_BASE_MS', SAVED.base);
  restore('AUTH_LOCKOUT_MAX_MS', SAVED.max);
  restore('REDIS_URL', SAVED.redis);
});

const VALID = { firstName: 'Vic', lastName: 'Tim', password: 'C0rrect-Horse!' };
const registerFrom = (ip: string, email: string) =>
  request(app.getHttpServer())
    .post('/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ ...VALID, email });
const loginFrom = (ip: string, email: string, password: string) =>
  request(app.getHttpServer())
    .post('/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password });
const forgotFrom = (ip: string, email: string) =>
  request(app.getHttpServer()).post('/auth/forgot-password').set('X-Forwarded-For', ip).send({ email });
const resetFrom = (ip: string, token: string) =>
  request(app.getHttpServer())
    .post('/auth/reset-password')
    .set('X-Forwarded-For', ip)
    .send({ token, newPassword: 'C0rrect-Horse!' });

describe('Per-IP lockout + ceiling (slice 39)', () => {
  it('AC-01: locks an IP after N failed logins — even a correct password is then rejected', async () => {
    const ip = '203.0.113.1';
    await registerFrom(ip, 'lockme@example.com').expect(201);
    for (let i = 0; i < THRESHOLD; i++) {
      const res = await loginFrom(ip, 'lockme@example.com', 'wrong-Password1');
      expect(res.status).not.toBe(429); // 401 invalid creds, not yet locked
    }
    const blocked = await loginFrom(ip, 'lockme@example.com', 'C0rrect-Horse!'); // correct password
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(String(blocked.body.detail)).toContain('failed attempts');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('AC-02: a successful login clears the failure counter', async () => {
    const ip = '203.0.113.2';
    await registerFrom(ip, 'clearme@example.com').expect(201);
    for (let i = 0; i < THRESHOLD - 1; i++) {
      expect((await loginFrom(ip, 'clearme@example.com', 'wrong-Password1')).status).not.toBe(429);
    }
    expect((await loginFrom(ip, 'clearme@example.com', 'C0rrect-Horse!')).status).toBe(200); // clears
    // Without the clear, the 2nd of these would be a 429 (counter would have reached the threshold).
    expect((await loginFrom(ip, 'clearme@example.com', 'wrong-Password1')).status).not.toBe(429);
    expect((await loginFrom(ip, 'clearme@example.com', 'wrong-Password1')).status).not.toBe(429);
  });

  it('AC-04: a second IP is unaffected while the first is locked', async () => {
    const locked = '203.0.113.10';
    const other = '203.0.113.11';
    await registerFrom(locked, 'a@example.com').expect(201);
    for (let i = 0; i < THRESHOLD; i++) await loginFrom(locked, 'a@example.com', 'wrong-Password1');
    expect((await loginFrom(locked, 'a@example.com', 'wrong-Password1')).status).toBe(429); // locked
    // A different IP is not throttled by the first IP's lock.
    expect((await loginFrom(other, 'a@example.com', 'wrong-Password1')).status).not.toBe(429);
  });

  it('AC-05: the per-IP ceiling catches spray across many accounts', async () => {
    const ip = '203.0.113.20';
    for (let i = 1; i <= IP_LIMIT; i++) {
      expect((await forgotFrom(ip, `spray${i}@example.com`)).status).toBe(202); // enumeration-safe
    }
    const blocked = await forgotFrom(ip, 'spray-over@example.com');
    expect(blocked.status).toBe(429);
    expect(String(blocked.body.detail)).toContain('network');
  });

  it('AC-07: reset-password failures feed the same per-IP lockout', async () => {
    const ip = '203.0.113.30';
    for (let i = 0; i < THRESHOLD; i++) {
      const res = await resetFrom(ip, 'invalid-token-xyz'); // invalid token -> VALIDATION (422)
      expect(res.status).not.toBe(429);
    }
    // The IP is now locked; a subsequent login from it is rejected (shared lockout bucket).
    const blocked = await loginFrom(ip, 'whoever@example.com', 'wrong-Password1');
    expect(blocked.status).toBe(429);
    expect(String(blocked.body.detail)).toContain('failed attempts');
  });
});
