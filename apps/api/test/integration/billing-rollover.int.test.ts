import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { ResetBillingUsage } from '@gilgamesh/application';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaSubscriptionRepository } from '../../src/persistence/prisma/prisma-repositories';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

const execFileAsync = promisify(execFile);
// test:int runs with cwd = apps/api, so the operator script sits under ./scripts.
const SCRIPT_PATH = resolve(process.cwd(), 'scripts/rollover-billing.mjs');
/** Run the REAL operator script in a child node process (inherits DATABASE_URL from the int env). */
const runScript = (args: string[]) =>
  execFileAsync(process.execPath, [SCRIPT_PATH, ...args], { env: process.env });

/**
 * Slice 21 (closes S14-6) — the REAL atomic usage rollover against Postgres. `resetUsage` is a
 * dedicated raw-SQL UPDATE that zeroes BOTH counters together; these exercise the per-org path, the
 * all-orgs path, idempotency, that no other column moves, and the two serial charge/reset orderings.
 */

let app: INestApplication;
let db: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [PrismaPersistenceModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  db = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE orgs, subscriptions CASCADE');
});

let seq = 0;
function uuid(): string {
  // Deterministic, valid v4-shaped uuids for the fixtures (Postgres ::uuid-castable).
  seq += 1;
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

async function seedOrgWithSubscription(overrides: {
  runMinutesUsed: number;
  brainTokensUsed: number;
  plan?: 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
}): Promise<string> {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const orgId = uuid();
  await db.org.create({
    data: { id: orgId, name: `Org ${orgId}`, slug: `org-${orgId}`, createdAt: now, updatedAt: now },
  });
  await db.subscription.create({
    data: {
      id: uuid(),
      orgId,
      plan: overrides.plan ?? 'STARTER',
      billingCycle: 'MONTHLY',
      seats: 3,
      status: 'ACTIVE',
      runMinutesQuota: 5_000,
      runMinutesUsed: overrides.runMinutesUsed,
      brainTokensQuota: 2_000_000,
      brainTokensUsed: overrides.brainTokensUsed,
      providerCustomerId: 'cus_123',
      providerSubscriptionId: 'sub_123',
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
  return orgId;
}

async function subFor(orgId: string) {
  const sub = await db.subscription.findUnique({ where: { orgId } });
  expect(sub).not.toBeNull();
  return sub!;
}

describe('Billing usage rollover (Prisma · real Postgres)', () => {
  it('AC-ROLL-01/02: zeroes BOTH counters for one org atomically and touches nothing else', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 250, brainTokensUsed: 73_000 });
    const before = await subFor(orgId);

    const rollover = new ResetBillingUsage({ subscriptions: new PrismaSubscriptionRepository(db) });
    const { reset } = await rollover.execute({ orgId });

    expect(reset).toBe(1);
    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
    // Every other column is preserved.
    expect(after.plan).toBe(before.plan);
    expect(after.seats).toBe(before.seats);
    expect(after.status).toBe(before.status);
    expect(after.runMinutesQuota).toBe(before.runMinutesQuota);
    expect(after.brainTokensQuota).toBe(before.brainTokensQuota);
    expect(after.billingCycle).toBe(before.billingCycle);
    expect(after.providerCustomerId).toBe(before.providerCustomerId);
    expect(after.providerSubscriptionId).toBe(before.providerSubscriptionId);
    expect(after.currentPeriodEnd?.getTime()).toBe(before.currentPeriodEnd?.getTime());
  });

  it('AC-ROLL-03: resetting ALL orgs zeroes every subscription and only that org otherwise', async () => {
    const orgA = await seedOrgWithSubscription({ runMinutesUsed: 100, brainTokensUsed: 9_000 });
    const orgB = await seedOrgWithSubscription({ runMinutesUsed: 480, brainTokensUsed: 5_000 });
    const orgC = await seedOrgWithSubscription({ runMinutesUsed: 4, brainTokensUsed: 2_000_000, plan: 'SCALE' });

    const rollover = new ResetBillingUsage({ subscriptions: new PrismaSubscriptionRepository(db) });

    // A targeted reset touches only its org.
    expect((await rollover.execute({ orgId: orgA })).reset).toBe(1);
    expect((await subFor(orgA)).brainTokensUsed).toBe(0);
    expect((await subFor(orgB)).brainTokensUsed).toBe(5_000);
    expect((await subFor(orgC)).brainTokensUsed).toBe(2_000_000);

    // The all-orgs reset zeroes the rest and reports every row.
    const all = await rollover.execute();
    expect(all.reset).toBe(3);
    for (const orgId of [orgA, orgB, orgC]) {
      const after = await subFor(orgId);
      expect(after.runMinutesUsed).toBe(0);
      expect(after.brainTokensUsed).toBe(0);
    }
  });

  it('AC-ROLL-04: is idempotent — a second reset keeps zero and still reports the matched row', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 0, brainTokensUsed: 0 });
    const rollover = new ResetBillingUsage({ subscriptions: new PrismaSubscriptionRepository(db) });

    expect((await rollover.execute({ orgId })).reset).toBe(1);
    // Postgres counts a no-change UPDATE as an affected row — parity with the in-memory adapter.
    expect((await rollover.execute({ orgId })).reset).toBe(1);
    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });

  it('AC-ROLL-05: resetting an org with no subscription row is a harmless no-op (0 rows)', async () => {
    const rollover = new ResetBillingUsage({ subscriptions: new PrismaSubscriptionRepository(db) });
    const { reset } = await rollover.execute({ orgId: '00000000-0000-4000-8000-ffffffffffff' });
    expect(reset).toBe(0);
  });

  it('AC-ROLL-06: reset-then-charge counts against the new period', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 100, brainTokensUsed: 40_000 });
    const repo = new PrismaSubscriptionRepository(db);

    await new ResetBillingUsage({ subscriptions: repo }).execute({ orgId });
    expect(await repo.chargeRunMinutes(orgId, 5)).toBe(true);
    await repo.chargeBrainTokens(orgId, 1_200);

    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(5);
    expect(after.brainTokensUsed).toBe(1_200);
  });

  it('AC-ROLL-06: charge-then-reset clears the pre-reset charge with the period', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 0, brainTokensUsed: 0 });
    const repo = new PrismaSubscriptionRepository(db);

    expect(await repo.chargeRunMinutes(orgId, 42)).toBe(true);
    await repo.chargeBrainTokens(orgId, 3_333);
    await new ResetBillingUsage({ subscriptions: repo }).execute({ orgId });

    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });
});

// Shells the REAL rollover-billing.mjs so its own (duplicated) SQL is exercised end-to-end against
// Postgres — the drift guard for a money tool whose statement is only otherwise int-tested via the
// adapter (review F3). Also proves the F2 all-orgs refusal doesn't touch data.
describe('Billing rollover operator script (real .mjs · drift + refusal guards)', () => {
  it('--org <id> zeroes BOTH counters for that org via the script’s own SQL', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 300, brainTokensUsed: 88_000 });
    const { stdout } = await runScript(['--org', orgId]);
    expect(stdout).toContain('1 row');
    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(0);
    expect(after.brainTokensUsed).toBe(0);
  });

  it('--all zeroes every org via the script', async () => {
    const a = await seedOrgWithSubscription({ runMinutesUsed: 10, brainTokensUsed: 1_000 });
    const b = await seedOrgWithSubscription({ runMinutesUsed: 20, brainTokensUsed: 2_000 });
    await runScript(['--all']);
    for (const orgId of [a, b]) {
      const after = await subFor(orgId);
      expect(after.runMinutesUsed).toBe(0);
      expect(after.brainTokensUsed).toBe(0);
    }
  });

  it('refuses a bare invocation (no --org/--all) and leaves every counter intact (F2)', async () => {
    const orgId = await seedOrgWithSubscription({ runMinutesUsed: 55, brainTokensUsed: 4_321 });
    const err = await runScript([]).then(
      () => null,
      (e: NodeJS.ErrnoException & { stderr?: string }) => e,
    );
    expect(err).not.toBeNull();
    expect(err?.code).toBe(1);
    expect(String(err?.stderr)).toContain('Refusing');
    // The guard fired before any UPDATE — nothing was reset.
    const after = await subFor(orgId);
    expect(after.runMinutesUsed).toBe(55);
    expect(after.brainTokensUsed).toBe(4_321);
  });
});
