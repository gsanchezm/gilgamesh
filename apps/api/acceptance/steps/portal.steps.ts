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

// Slice 34 — POST /orgs/{orgId}/billing/portal (session + CSRF, OWNER/ADMIN).

When('I open the billing portal', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/orgs/{orgId}/billing/portal'))).send();
});

When('an unauthenticated client opens the billing portal', async function (this: GilgameshWorld) {
  this.response = await server(this).post(this.url('/orgs/{orgId}/billing/portal')).send();
});

When('I open the billing portal without the CSRF token', async function (this: GilgameshWorld) {
  this.response = await server(this)
    .post(this.url('/orgs/{orgId}/billing/portal'))
    .set('Cookie', this.cookie ?? '')
    .send();
});

Then('a mock portal url is returned', function (this: GilgameshWorld) {
  assert.match(String(body(this).portalUrl ?? ''), /^https:\/\/mock\.pay\/portal\//);
});
