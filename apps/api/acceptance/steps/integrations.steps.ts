import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

function integrationsPath(world: GilgameshWorld, key?: string): string {
  const base = `${world.basePath}/orgs/${world.lastOrgId}/integrations`;
  return key ? `${base}/${key}` : base;
}

When('I connect the {string} integration with token {string}', async function (this: GilgameshWorld, key: string, token: string) {
  this.notes.set('lastToken', token);
  this.response = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({ action: 'connect', token });
});

When('I disconnect the {string} integration', async function (this: GilgameshWorld, key: string) {
  this.response = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({ action: 'disconnect' });
});

When('I list integrations', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).get(integrationsPath(this)));
});

When('I import the repo {string} on branch {string}', async function (this: GilgameshWorld, fullName: string, branch: string) {
  this.response = await this.applyAuth(server(this).post(`${this.basePath}/projects/${this.lastProjectId}/repo/import`)).send({ fullName, branch });
});

async function connectedState(world: GilgameshWorld, key: string): Promise<boolean | undefined> {
  const res = await world.applyAuth(server(world).get(integrationsPath(world)));
  const item = (res.body as { key: string; connected: boolean }[]).find((i) => i.key === key);
  return item?.connected;
}

Then('the {string} integration is connected', async function (this: GilgameshWorld, key: string) {
  assert.equal(await connectedState(this, key), true);
});

Then('the {string} integration is not connected', async function (this: GilgameshWorld, key: string) {
  assert.equal(await connectedState(this, key), false);
});

Then('the response does not contain the token', function (this: GilgameshWorld) {
  const token = this.notes.get('lastToken') as string;
  assert.ok(!JSON.stringify(this.response?.body ?? {}).includes(token), 'the token leaked in the response body');
});

Then('{int} features were imported', function (this: GilgameshWorld, n: number) {
  assert.equal((this.response?.body as { imported: number }).imported, n);
});
