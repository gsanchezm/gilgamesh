import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdAppModule } from '../../src/app.module';
import { ShutdownState } from '../../src/health/shutdown-state';

let app: INestApplication;
let shutdown: ShutdownState;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProdAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1'); // mirrors main.ts
  await app.init();
  shutdown = app.get(ShutdownState);
});

afterAll(async () => {
  await app.close();
});

/**
 * Slice 29 — graceful shutdown against the REAL Prisma/Postgres wiring (PrismaReadinessProbe). Proves
 * that draining forces readiness to 503 even though the DB probe (SELECT 1) would answer READY, while
 * liveness stays 200 — the same drain/liveness invariant as the Docker-free e2e, but with the real
 * DB probe wired. Written for the orchestrator's `test:int`; NOT run in the feature stream.
 */
describe('Graceful shutdown (ProdAppModule · real Postgres)', () => {
  it('AC-SHUT-01: /api/v1/health/ready is 200 ready before draining (DB reachable)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('AC-SHUT-02/03: after beginDraining, readiness is 503 while liveness stays 200 (same instance)', async () => {
    shutdown.beginDraining();

    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: 'not-ready' });

    const live = await request(app.getHttpServer()).get('/api/v1/health');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });
  });
});
