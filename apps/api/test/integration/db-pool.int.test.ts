import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
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
    // Presence, not exact value: an ambient DATABASE_URL may already carry an operator-set param,
    // which the helper (correctly) preserves — exact-value pins live in pool-config.test.ts against
    // URLs the unit test fully controls. Here we prove only that the real connection URL is complete.
    expect(augmented.searchParams.has('connection_limit')).toBe(true);
    expect(augmented.searchParams.has('pool_timeout')).toBe(true);
    expect(augmented.searchParams.has('connect_timeout')).toBe(true);
    // Original params/identity untouched (no clobber):
    expect(augmented.searchParams.get('schema')).toBe(original.searchParams.get('schema'));
    expect(augmented.hostname).toBe(original.hostname);
    expect(augmented.pathname).toBe(original.pathname);
    expect(augmented.username).toBe(original.username);
  });
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a DSN whose `connection_limit` is deterministically `limit`, using the PRODUCTION helper
 * `withPoolDefaults`. Any ambient `connection_limit` / `pool_timeout` is stripped first so the
 * helper's absent-only `set` writes OUR values regardless of the DATABASE_URL this suite inherits —
 * i.e. the DSN under test is exactly what `PrismaService` would hand Prisma in prod.
 */
function boundedDsn(base: string, limit: number): string {
  const u = new URL(base);
  u.searchParams.delete('connection_limit');
  u.searchParams.delete('pool_timeout');
  return withPoolDefaults(u.toString(), {
    connectionLimit: limit,
    poolTimeoutS: 10, // > the total sleep window below, so queued queries never pool-timeout
    connectTimeoutS: 10,
  })!;
}

/**
 * Slice 36 — ENGINE-LEVEL proof that `connection_limit` actually bounds real Postgres backends,
 * not merely that `withPoolDefaults` builds the right string (which pool-config.test.ts already
 * pins). The invariant: a client whose DSN carries `connection_limit=N` (as produced by the
 * production `withPoolDefaults`) NEVER holds more than N concurrent backends at the engine, even
 * when driven with more concurrent queries than N.
 *
 * Mechanism (read-only; safe against the SHARED int Postgres — no TRUNCATE, no writes):
 *  - `limited`  — a PrismaClient with `connection_limit=LIMIT`; fires CONCURRENCY (> LIMIT) queries
 *    that each hold a backend briefly (`SELECT pg_sleep(...)`). Only LIMIT can hold a real backend
 *    at once; the excess wait in Prisma's client-side pool and never reach Postgres.
 *  - `observer` — an INDEPENDENT PrismaClient that polls `pg_stat_activity`, counting active
 *    backends running a `pg_sleep` query (filtered by `datname = current_database()`), and records
 *    the PEAK. The filter keys off the intrinsic function name `pg_sleep` (un-strippable — survives
 *    comment normalization / parameterization), excludes the observer's own poll (its query text
 *    references `pg_stat_activity`) and its own backend (`pid <> pg_backend_pid()`). Serial int
 *    execution (`fileParallelism: false`) + nothing else in the app issuing `pg_sleep` makes the
 *    signal unambiguous.
 *
 * Written but NOT run in this stream (the shared int DB is used by concurrent worktrees). The
 * orchestrator runs it serially via `pnpm --filter @gilgamesh/api test:int`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'DB pool connection_limit is enforced at the Postgres engine (slice 36)',
  () => {
    const LIMIT = 2; // small on purpose — the bound we prove the engine honors
    const CONCURRENCY = 6; // > LIMIT: the excess must queue in Prisma's pool, not open backends
    const SLEEP_S = 0.6; // long enough to be reliably observed; short enough to keep the test ~2s
    const POLL_MS = 40; // ~15 samples per 0.6s batch → the peak is caught deterministically

    let limited: PrismaClient;
    let observer: PrismaClient;

    beforeAll(async () => {
      const base = process.env.DATABASE_URL!;
      limited = new PrismaClient({ datasourceUrl: boundedDsn(base, LIMIT) });
      observer = new PrismaClient({ datasourceUrl: base }); // unbounded pool — polling is never starved
      // Warm both pools so first-connect latency doesn't eat into the observation window.
      await limited.$connect();
      await observer.$connect();
    });

    afterAll(async () => {
      // Leave no dangling backend for the next (shared-DB) suite. Both clients, always.
      await limited?.$disconnect();
      await observer?.$disconnect();
    });

    /** Count THIS test's concurrently-active sleep backends on the current DB. */
    async function activeSleepBackends(): Promise<number> {
      const rows = await observer.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND pid <> pg_backend_pid()
          AND query LIKE ${'%pg_sleep%'}
          AND query NOT LIKE ${'%pg_stat_activity%'}
      `;
      return rows[0]?.n ?? 0;
    }

    it('never holds more than connection_limit concurrent backends under CONCURRENCY > limit load', async () => {
      // `pg_sleep` returns SQL `void`, which Prisma's $queryRaw cannot deserialize ("Failed to
      // deserialize column of type 'void'"). Using it in FROM yields one row and lets us project a
      // real int column (`ok`), so the query returns cleanly WHILE still holding a backend for the
      // sleep. The query text still contains the intrinsic `pg_sleep` (the observer's WHERE filter)
      // and never contains `pg_stat_activity` (the observer's self-exclusion). The trailing tag is
      // cosmetic — NOT part of the filter.
      const sleepSql = `SELECT 1 AS ok FROM pg_sleep(${SLEEP_S}) /* slice-36 pool probe */`;

      let peak = 0;
      let observing = true;
      const poll = (async () => {
        while (observing) {
          const n = await activeSleepBackends();
          if (n > peak) peak = n;
          await delay(POLL_MS);
        }
      })();

      // Fire CONCURRENCY sleeps at once through the bounded client. With LIMIT=2 they run in serial
      // batches of 2; the engine never sees a 3rd concurrent backend from this client. `finally`
      // guarantees the poll loop stops + is awaited even if a query rejects (no orphaned loop).
      try {
        await Promise.all(
          Array.from({ length: CONCURRENCY }, () => limited.$queryRawUnsafe(sleepSql)),
        );
      } finally {
        observing = false;
        await poll; // let the in-flight poll iteration settle
      }

      // Non-vacuous floor: we genuinely observed active sleep backends (guards a false pass where the
      // window was simply missed and nothing was counted).
      expect(peak).toBeGreaterThanOrEqual(1);
      // THE invariant: at no instant did the bounded client hold more backends than connection_limit.
      // `<=` (not `=== LIMIT`) tolerates Prisma ramping the pool lazily / an internal connection.
      // If `connection_limit` were ignored, peak would climb toward CONCURRENCY and this would fail.
      expect(peak).toBeLessThanOrEqual(LIMIT);
    });
  },
);
