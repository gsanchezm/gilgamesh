import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}
function body(world: GilgameshWorld): Record<string, unknown> {
  return (world.response?.body ?? {}) as Record<string, unknown>;
}

When('I GET the subscription', async function (this: GilgameshWorld) {
  this.response = await server(this)
    .get(this.url('/orgs/{orgId}/subscription'))
    .set('Cookie', this.cookie ?? '');
});

When('I change the plan to {string}', async function (this: GilgameshWorld, plan: string) {
  this.response = await this.applyAuth(server(this).patch(this.url('/orgs/{orgId}/subscription'))).send({ plan });
});

// Slice 10 (4-tier migration): plan change with an explicit billing cycle.
When(
  'I change the plan to {string} on the {string} cycle',
  async function (this: GilgameshWorld, plan: string, billingCycle: string) {
    this.response = await this.applyAuth(server(this).patch(this.url('/orgs/{orgId}/subscription'))).send({
      plan,
      billingCycle,
    });
  },
);

When('I update seats to {int}', async function (this: GilgameshWorld, seats: number) {
  this.response = await this.applyAuth(server(this).patch(this.url('/orgs/{orgId}/subscription/seats'))).send({ seats });
});

When('I start checkout', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/orgs/{orgId}/subscription/checkout'))).send();
});

When('I confirm the checkout', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(
    server(this).post(this.url('/orgs/{orgId}/subscription/checkout/confirm')),
  ).send();
});

When('I cancel the subscription', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/orgs/{orgId}/subscription/cancel'))).send();
});

// Slice 40 — proration + refunds.
When('I preview a change to {string}', async function (this: GilgameshWorld, plan: string) {
  this.response = await this.applyAuth(server(this).post(this.url('/orgs/{orgId}/subscription/preview'))).send({ plan });
});

When('I cancel the subscription with a refund', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/orgs/{orgId}/subscription/cancel'))).send({ refund: true });
});

Then('the subscription plan is {string}', function (this: GilgameshWorld, plan: string) {
  assert.equal(body(this).plan, plan);
});

Then('the subscription status is {string}', function (this: GilgameshWorld, status: string) {
  assert.equal(body(this).status, status);
});

Then('the subscription quota is {int}', function (this: GilgameshWorld, quota: number) {
  assert.equal(body(this).runMinutesQuota, quota);
});

Then('a mock checkout url is returned', function (this: GilgameshWorld) {
  assert.match(String(body(this).checkoutUrl ?? ''), /^https:\/\/mock\.pay\/checkout\//);
});

// Slice 10 (4-tier migration): the SubscriptionView exposes the computed price + catalog limits.
Then('the subscription price is {int} cents', function (this: GilgameshWorld, cents: number) {
  assert.equal(body(this).priceCents, cents);
});

Then('the subscription allows {int} services per workspace', function (this: GilgameshWorld, services: number) {
  assert.equal(body(this).maxServicesPerWorkspace, services);
});

Then('the subscription has {int} active workspaces', function (this: GilgameshWorld, seats: number) {
  assert.equal(body(this).seats, seats);
});

Then('the subscription executions are unlimited', function (this: GilgameshWorld) {
  assert.equal(body(this).unlimited, true);
});

// Slice 40 — proration/refund amounts. The BDD sweep runs the mock arm under SystemClock (real time),
// so amounts aren't pinnable to the cent — we assert the SIGN.
Then('the proration amount is zero', function (this: GilgameshWorld) {
  assert.equal(body(this).prorationCents, 0);
});

Then('the proration amount is positive', function (this: GilgameshWorld) {
  assert.ok(Number(body(this).prorationCents) > 0, `expected prorationCents > 0, got ${body(this).prorationCents}`);
});

Then('the proration amount is negative', function (this: GilgameshWorld) {
  assert.ok(Number(body(this).prorationCents) < 0, `expected prorationCents < 0, got ${body(this).prorationCents}`);
});

Then('the refund amount is positive', function (this: GilgameshWorld) {
  assert.ok(Number(body(this).refundedCents) > 0, `expected refundedCents > 0, got ${body(this).refundedCents}`);
});

Then('no refund amount is returned', function (this: GilgameshWorld) {
  assert.equal(body(this).refundedCents, undefined);
});
