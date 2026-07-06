import {
  CompleteOnboarding,
  type Repositories,
  type SubscriptionRepository,
  type UnitOfWork,
} from '@gilgamesh/application';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock, Uuid7IdGenerator } from '../../src/infra';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../src/persistence/prisma/prisma-unit-of-work';

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
  await db.$executeRawUnsafe(
    'TRUNCATE orgs, users, memberships, sessions, projects, slices, agents, tool_bindings, subscriptions, audit_logs CASCADE',
  );
});

/**
 * Onboarding bootstrap must be all-or-nothing (spec AC-ONB-12). This is the int-test counterpart
 * of the @manual feature scenario: a fault is injected mid-transaction (Subscription create throws,
 * after Org + Membership + Agents have been written) and we assert the whole tenant rolled back.
 */
describe('Onboarding bootstrap rollback (Prisma · real Postgres)', () => {
  it('rolls back Org, Membership, Agents, Subscription and Project when a write fails partway', async () => {
    const ids = new Uuid7IdGenerator();
    const now = new SystemClock().now();
    const userId = ids.next();
    await db.user.create({
      data: {
        id: userId,
        email: 'ishtar@uruk.io',
        passwordHash: '$argon2id$dummy',
        firstName: 'Ishtar',
        middleName: null,
        lastName: 'Uruk',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
    });

    // A UnitOfWork that runs the real Prisma transaction but makes Subscription.create throw,
    // forcing a rollback after Org/Membership/Agents have already been inserted in-tx.
    const prismaUow = new PrismaUnitOfWork(db);
    const faultyUow: UnitOfWork = {
      transaction: (work) =>
        prismaUow.transaction((repos) => {
          const subscriptions: SubscriptionRepository = {
            create: async () => {
              throw new Error('boom: subscription write failed');
            },
            findByOrg: (orgId) => repos.subscriptions.findByOrg(orgId),
            save: (rec) => repos.subscriptions.save(rec),
            chargeRunMinutes: (orgId, minutes) => repos.subscriptions.chargeRunMinutes(orgId, minutes),
            chargeBrainTokens: (orgId, tokens) => repos.subscriptions.chargeBrainTokens(orgId, tokens),
            findByProviderCustomerId: (id) => repos.subscriptions.findByProviderCustomerId(id),
          };
          return work({ ...repos, subscriptions } as Repositories);
        }),
    };

    const onboard = new CompleteOnboarding({ uow: faultyUow, ids, clock: new SystemClock() });

    await expect(
      onboard.execute({ userId, projectName: 'OmniPizza', format: 'BDD' }),
    ).rejects.toThrow(/boom/);

    // Nothing the transaction touched survives.
    expect(await db.org.count()).toBe(0);
    expect(await db.membership.count()).toBe(0);
    expect(await db.agent.count()).toBe(0);
    expect(await db.subscription.count()).toBe(0);
    expect(await db.project.count()).toBe(0);
    expect(await db.toolBinding.count()).toBe(0);
    // The pre-existing user (created outside the failed transaction) is untouched.
    expect(await db.user.count()).toBe(1);
  });
});
