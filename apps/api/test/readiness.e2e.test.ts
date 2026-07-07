import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { ReadinessProbe } from '../src/health/readiness';
import { TOKENS } from '../src/persistence/tokens';

/**
 * Slice 27 — health readiness. The default AppModule wires the in-memory persistence, whose
 * readiness probe is trivially ready (AlwaysReadyProbe). The invariant block below overrides the
 * probe with a FAILING fake to prove the liveness/readiness separation on one app instance.
 * Paths have no /api/v1 prefix here (AppModule, no global prefix); production adds it (int test).
 */

describe('Readiness — in-memory / always-ready wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/ready returns 200 {status:ready} when the store is reachable (AC-RDY-02)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /health stays 200 {status:ok} — liveness unchanged (AC-RDY-01)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Readiness invariant — a failing DB probe never affects liveness', () => {
  let app: INestApplication;
  // Simulates an unreachable/asleep Postgres: the probe rejects on every call.
  const failing: ReadinessProbe = {
    check: () => Promise.reject(new Error('db unreachable')),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKENS.Readiness)
      .useValue(failing)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // The load-bearing proof: SAME app instance, DB probe failing → readiness 503 AND liveness 200.
  it('GET /health/ready returns 503 {status:not-ready} — a clean 503, NOT 500/hang (AC-RDY-03)', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not-ready' });
  });

  it('GET /health STILL returns 200 {status:ok} — liveness has NO DB dependency (AC-RDY-01)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
