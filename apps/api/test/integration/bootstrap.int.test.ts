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
 * The production composition (ProdAppModule) must boot against real Postgres and serve under
 * the spec's /api/v1 prefix — this is the int-test proof that the app is a real runnable server
 * wired to Prisma (audit Crítico: previously no main.ts and in-memory persistence by default).
 */
describe('Production bootstrap (ProdAppModule · real Postgres)', () => {
  it('boots with Prisma persistence and serves health under /api/v1', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not serve routes without the /api/v1 prefix', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(404);
  });
});
