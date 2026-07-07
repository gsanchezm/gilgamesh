import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { ResetBillingUsage } from '@gilgamesh/application';
import type { GilgameshWorld } from '../support/world';
import { PrismaSubscriptionRepository } from '../../src/persistence/prisma/prisma-repositories';

/**
 * Slice 21 — usage-counter rollover (S14-6). There is no HTTP surface (owner decision S21-C), so
 * these steps drive the `ResetBillingUsage` use case directly over a Prisma-backed repository — the
 * exact wiring the `rollover:billing` operator script uses.
 */

const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000aa';

function rollover(world: GilgameshWorld): ResetBillingUsage {
  return new ResetBillingUsage({ subscriptions: new PrismaSubscriptionRepository(world.db) });
}

async function currentSub(world: GilgameshWorld) {
  const sub = await world.db.subscription.findUnique({ where: { orgId: world.lastOrgId! } });
  assert.ok(sub, 'no subscription row for the current org');
  return sub;
}

// ---- Seeding the counters ----------------------------------------------------------------------

Given(
  "my org's usage counters are {int} execution minutes and {int} AI tokens",
  async function (this: GilgameshWorld, minutes: number, tokens: number) {
    await this.db.subscription.updateMany({
      where: { orgId: this.lastOrgId! },
      data: { runMinutesUsed: minutes, brainTokensUsed: tokens },
    });
  },
);

Given(
  'another org has usage counters of {int} execution minutes and {int} AI tokens',
  async function (this: GilgameshWorld, minutes: number, tokens: number) {
    const now = new Date('2026-07-01T00:00:00.000Z');
    await this.db.org.create({
      data: { id: OTHER_ORG_ID, name: 'Other Org', slug: 'other-org', createdAt: now, updatedAt: now },
    });
    await this.db.subscription.create({
      data: {
        id: '00000000-0000-4000-8000-0000000000ab',
        orgId: OTHER_ORG_ID,
        plan: 'STARTER',
        billingCycle: 'MONTHLY',
        seats: 1,
        status: 'ACTIVE',
        runMinutesQuota: 5_000,
        runMinutesUsed: minutes,
        brainTokensQuota: 2_000_000,
        brainTokensUsed: tokens,
        providerCustomerId: null,
        providerSubscriptionId: null,
        currentPeriodEnd: null,
      },
    });
  },
);

Given("I note the org's subscription plan and quotas", async function (this: GilgameshWorld) {
  const sub = await currentSub(this);
  this.notes.set('subSnapshot', {
    plan: sub.plan,
    billingCycle: sub.billingCycle,
    seats: sub.seats,
    status: sub.status,
    runMinutesQuota: sub.runMinutesQuota,
    brainTokensQuota: sub.brainTokensQuota,
    providerCustomerId: sub.providerCustomerId,
    providerSubscriptionId: sub.providerSubscriptionId,
    currentPeriodEnd: sub.currentPeriodEnd?.getTime() ?? null,
  });
});

Given(
  'my org is charged {int} execution minutes and {int} AI tokens',
  async function (this: GilgameshWorld, minutes: number, tokens: number) {
    const repo = new PrismaSubscriptionRepository(this.db);
    const charged = await repo.chargeRunMinutes(this.lastOrgId!, minutes);
    assert.ok(charged, 'chargeRunMinutes was rejected by the quota guard');
    await repo.chargeBrainTokens(this.lastOrgId!, tokens);
  },
);

// ---- Running the rollover ----------------------------------------------------------------------

When('the billing rollover runs for my org', async function (this: GilgameshWorld) {
  const { reset } = await rollover(this).execute({ orgId: this.lastOrgId! });
  this.notes.set('rolloverReset', reset);
});

When('the billing rollover runs for all orgs', async function (this: GilgameshWorld) {
  const { reset } = await rollover(this).execute();
  this.notes.set('rolloverReset', reset);
});

// ---- Assertions --------------------------------------------------------------------------------

Then('the rollover reset {int} subscription(s)', function (this: GilgameshWorld, n: number) {
  assert.equal(this.notes.get('rolloverReset'), n);
});

Then("the org's execution minutes counter is {int}", async function (this: GilgameshWorld, n: number) {
  assert.equal((await currentSub(this)).runMinutesUsed, n);
});

Then("the org's AI token counter is {int}", async function (this: GilgameshWorld, n: number) {
  assert.equal((await currentSub(this)).brainTokensUsed, n);
});

Then("the org's subscription plan and quotas are unchanged", async function (this: GilgameshWorld) {
  const snap = this.notes.get('subSnapshot') as Record<string, unknown>;
  const sub = await currentSub(this);
  assert.deepEqual(
    {
      plan: sub.plan,
      billingCycle: sub.billingCycle,
      seats: sub.seats,
      status: sub.status,
      runMinutesQuota: sub.runMinutesQuota,
      brainTokensQuota: sub.brainTokensQuota,
      providerCustomerId: sub.providerCustomerId,
      providerSubscriptionId: sub.providerSubscriptionId,
      currentPeriodEnd: sub.currentPeriodEnd?.getTime() ?? null,
    },
    snap,
  );
});

Then("the other org's usage counters are both zero", async function (this: GilgameshWorld) {
  const sub = await this.db.subscription.findUnique({ where: { orgId: OTHER_ORG_ID } });
  assert.ok(sub, 'no subscription row for the other org');
  assert.equal(sub.runMinutesUsed, 0);
  assert.equal(sub.brainTokensUsed, 0);
});
