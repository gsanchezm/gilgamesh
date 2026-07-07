import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureBodyParser } from '../src/common/body-parser';
import { configureRequestId } from '../src/common/request-id';

/**
 * Request/response correlation ids (slice 24). Boots the same middleware wiring `main.ts` uses —
 * `configureRequestId` first, then `configureBodyParser` — so the e2e exercises the real placement,
 * incl. a body-parser-layer error (413) which is raised at the same layer as the middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureRequestId(app as NestExpressApplication);
  configureBodyParser(app as NestExpressApplication);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('Request correlation id (slice 24)', () => {
  it('AC-RID-01: every response carries an X-Request-Id header', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('AC-RID-02: a sane client-supplied X-Request-Id is trusted and echoed', async () => {
    const supplied = 'trace-abc_123.9';
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', supplied);
    expect(res.headers['x-request-id']).toBe(supplied);
  });

  it('AC-RID-03: an over-long client id is replaced with a fresh server id (not reflected)', async () => {
    const overLong = 'a'.repeat(200);
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', overLong);
    expect(res.headers['x-request-id']).not.toBe(overLong);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('AC-RID-03: a client id with unsafe characters is replaced (header/log-injection guard)', async () => {
    // Space + colon + semicolon — the shape of a header/log-injection attempt. Node forbids literal
    // CR/LF in a sent header value, so this stands in for that class; both fail the charset check.
    const unsafe = 'evil: value; DROP';
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', unsafe);
    expect(res.headers['x-request-id']).not.toBe(unsafe);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('AC-RID-04/06: a mapped error body carries requestId == the response header, additively', async () => {
    const supplied = 'trace-mapped_42';
    const res = await request(app.getHttpServer()).get('/no-such-route').set('X-Request-Id', supplied);
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe(supplied);
    expect(res.body.requestId).toBe(supplied);
    // Additive: the five existing RFC9457 members are untouched.
    expect(res.body).toMatchObject({
      type: 'about:blank',
      status: 404,
      code: expect.any(String),
      detail: expect.any(String),
    });
    expect(res.body.title).toEqual(expect.any(String));
  });

  it('AC-RID-03/04/06: a body-parser 413 (error before the app pipeline) still returns a fresh, stable requestId', async () => {
    const garbage = 'x'.repeat(300); // over-long → must be replaced, not reflected
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('X-Request-Id', garbage)
      .send({ firstName: 'a'.repeat(600 * 1024), lastName: 'x', email: 'big@uruk.io', password: 'C0rrect-Horse!' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    const id = res.headers['x-request-id'];
    expect(id).toMatch(UUID);
    expect(id).not.toBe(garbage);
    // Stable: the error body quotes the exact id the client received on the header.
    expect(res.body.requestId).toBe(id);
  });
});
