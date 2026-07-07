import { describe, expect, it } from 'vitest';
import { PrismaReadinessProbe, type RawQueryRunner } from './prisma-readiness.probe';

// A hung query: the promise never settles, so only the timeout can resolve the race.
const hung = (): Promise<never> => new Promise<never>(() => {});

describe('PrismaReadinessProbe', () => {
  it('resolves when SELECT 1 answers (AC-RDY-02)', async () => {
    const db: RawQueryRunner = { $queryRaw: () => Promise.resolve([{ ['?column?']: 1 }]) };
    await expect(new PrismaReadinessProbe(db).check()).resolves.toBeUndefined();
  });

  it('rejects when the query errors — controller maps this to 503 (AC-RDY-03)', async () => {
    const db: RawQueryRunner = { $queryRaw: () => Promise.reject(new Error('ECONNREFUSED')) };
    await expect(new PrismaReadinessProbe(db).check()).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects within its bound when the DB hangs — never a hanging probe (AC-RDY-04)', async () => {
    const probe = new PrismaReadinessProbe({ $queryRaw: hung }, 10); // 10ms bound
    const start = Date.now();
    await expect(probe.check()).rejects.toThrow(/timed out/);
    // The bound fires promptly; it must not block anywhere near the default 2s.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('issues exactly one SELECT 1 per check', async () => {
    let calls = 0;
    const db: RawQueryRunner = {
      $queryRaw: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    };
    await new PrismaReadinessProbe(db).check();
    expect(calls).toBe(1);
  });
});
