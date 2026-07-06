import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaPasswordResetRepository } from './prisma-repositories';

/**
 * Docker-free shape test for the audit-#6 fix: the claim must be CONDITIONAL in the WHERE
 * clause (`usedAt: null`), so a concurrent double-submit races inside Postgres, not in app
 * code. The real row-lock semantics run under `test:int`; here we pin the query shape.
 */
describe('PrismaPasswordResetRepository.claimUnused', () => {
  const at = new Date('2026-07-06T12:00:00.000Z');

  function repoWith(count: number) {
    const updateMany = vi.fn(async () => ({ count }));
    const db = { passwordReset: { updateMany } } as unknown as Prisma.TransactionClient;
    return { repo: new PrismaPasswordResetRepository(db), updateMany };
  }

  it('claims via updateMany conditioned on usedAt: null and reports the claim', async () => {
    const { repo, updateMany } = repoWith(1);
    await expect(repo.claimUnused('pr-1', at)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'pr-1', usedAt: null },
      data: { usedAt: at },
    });
  });

  it('returns false when the row was already claimed (or gone)', async () => {
    const { repo } = repoWith(0);
    await expect(repo.claimUnused('pr-1', at)).resolves.toBe(false);
  });
});
