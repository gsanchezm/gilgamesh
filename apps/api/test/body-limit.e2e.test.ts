import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureBodyParser } from '../src/common/body-parser';

/**
 * The body-parser limit (audit #2) must be large enough to accept the biggest valid request
 * (feature.content ≤ 256 KiB) yet still reject genuinely oversized payloads — and it must be
 * deterministic, not Nest's implicit 100 KiB default. These boot the same `configureBodyParser`
 * wiring `main.ts` uses and assert both sides of the boundary.
 */
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureBodyParser(app as NestExpressApplication);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('HTTP body-size limit (audit #2)', () => {
  it('rejects a payload larger than the configured limit with 413 problem+json', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ firstName: 'a'.repeat(600 * 1024), lastName: 'x', email: 'big@uruk.io', password: 'C0rrect-Horse!' });
    expect(res.status).toBe(413);
    // Mapped through the domain filter, not a leaked Nest/Express default shape.
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a ~300 KiB body (above the 100 KiB default) — reaches validation, not 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ firstName: 'a'.repeat(300 * 1024), lastName: 'x', email: 'mid@uruk.io', password: 'C0rrect-Horse!' });
    // Parser let it through (not 413); the over-long firstName fails @MaxLength → 422 (RFC9457).
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(422);
  });

  it('rejects an over-long password at validation, before hashing (audit #1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ firstName: 'A', lastName: 'B', email: 'long@uruk.io', password: 'a'.repeat(300) });
    expect(res.status).toBe(422);
  });
});
