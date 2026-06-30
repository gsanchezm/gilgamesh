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
