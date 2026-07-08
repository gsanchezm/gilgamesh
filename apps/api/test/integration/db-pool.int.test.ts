import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdAppModule } from '../../src/app.module';
import { withPoolDefaults } from '../../src/persistence/prisma/pool-config';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProdAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1'); // mirrors main.ts
  await app.init();
  prisma = moduleRef.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

/**
 * Slice 31 proof (written but NOT run in this stream — the orchestrator runs `test:int` at merge):
 * the augmented DATABASE_URL (bounded pool defaults appended) STILL connects to the real localhost
 * Postgres and the app performs real DB round-trips through it. This is the load-bearing evidence
 * that "the helper only adds absent params, so localhost keeps working".
 */
describe('DB pool config (real Postgres · augmented DATABASE_URL)', () => {
  it('boots with Prisma and the augmented URL performs a real SELECT round-trip', async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ok).toBe(1);
  });

  it('readiness (a real SELECT 1 through the augmented pool) is 200 ready', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('the helper appends the pool params while preserving the original DSN (schema, host, db)', () => {
    const original = new URL(process.env.DATABASE_URL!);
    const augmented = new URL(withPoolDefaults(process.env.DATABASE_URL)!);
    expect(augmented.searchParams.get('connection_limit')).toBe('5');
    expect(augmented.searchParams.get('pool_timeout')).toBe('10');
    expect(augmented.searchParams.get('connect_timeout')).toBe('10');
    // Original params/identity untouched (no clobber):
    expect(augmented.searchParams.get('schema')).toBe(original.searchParams.get('schema'));
    expect(augmented.hostname).toBe(original.hostname);
    expect(augmented.pathname).toBe(original.pathname);
    expect(augmented.username).toBe(original.username);
  });
});
