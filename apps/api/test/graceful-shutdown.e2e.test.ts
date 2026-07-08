import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ShutdownState } from '../src/health/shutdown-state';

/**
 * Slice 29 — graceful shutdown. The default AppModule wires the in-memory persistence, whose
 * readiness probe is trivially ready (AlwaysReadyProbe). We flip the shared ShutdownState directly
 * (Docker-free = no real SIGTERM) and prove, on a SINGLE app instance, that draining forces readiness
 * to 503 EVEN with an always-ready DB probe, while liveness stays 200 and the process keeps serving.
 * Paths have no /api/v1 prefix here (AppModule, no global prefix); production adds it (int test).
 */

describe('Graceful shutdown — before draining (baseline)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC-SHUT-01: GET /health/ready is 200 {status:ready} before draining', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('AC-SHUT-03: GET /health is 200 {status:ok} before draining', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Graceful shutdown — while draining (SIGTERM window)', () => {
  let app: INestApplication;
  let shutdown: ShutdownState;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // The SAME singleton the HealthController injects — exactly what main.ts flips on SIGTERM.
    shutdown = app.get(ShutdownState);
    shutdown.beginDraining();
  });

  afterAll(async () => {
    await app.close();
  });

  // The load-bearing proof: AlwaysReadyProbe would answer READY, yet readiness is 503 — so the drain
  // check short-circuits BEFORE the DB probe (AC-SHUT-02).
  it('AC-SHUT-02: GET /health/ready is 503 {status:not-ready} while draining, even with an always-ready probe', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not-ready' });
  });

  it('AC-SHUT-03: GET /health STILL returns 200 {status:ok} while draining — liveness never flips', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('AC-SHUT-05: the process keeps serving requests during the drain window (app not yet closed)', async () => {
    // Requests issued after beginDraining() still complete: readiness answers 503, liveness 200 —
    // both RESPOND, proving traffic is served during the grace window (not through app.close()).
    const [ready, live] = await Promise.all([
      request(app.getHttpServer()).get('/health/ready'),
      request(app.getHttpServer()).get('/health'),
    ]);
    expect(ready.status).toBe(503);
    expect(live.status).toBe(200);
  });
});
