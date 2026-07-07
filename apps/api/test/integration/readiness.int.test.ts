import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdAppModule } from '../../src/app.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProdAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1'); // mirrors main.ts
  await app.init();
});

afterAll(async () => {
  await app.close();
});

/**
 * Slice 27 readiness against the REAL Postgres wiring (PrismaReadinessProbe → `SELECT 1`). This is
 * the proof that readiness reports ready when Postgres is actually reachable — the Docker-free e2e
 * can only fake the probe. NOT run in the build stream; the orchestrator runs `test:int` at merge.
 */
describe('Readiness (ProdAppModule · real Postgres)', () => {
  it('GET /api/v1/health/ready returns 200 {status:ready} when the DB is reachable (AC-RDY-02)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('GET /api/v1/health stays 200 {status:ok} — liveness, no DB dependency (AC-RDY-01)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
