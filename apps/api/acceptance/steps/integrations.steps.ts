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

// Fail-closed guard on the REAL persistence path (S6-B): the token is never in the row or audit; only a vault ref.
Then('no integration row or audit event contains the token', async function (this: GilgameshWorld) {
  const token = this.notes.get('lastToken') as string;
  const rows = await this.db.integration.findMany({ where: { orgId: this.lastOrgId! } });
  const audits = await this.db.auditLog.findMany({ where: { orgId: this.lastOrgId! } });
  assert.ok(!JSON.stringify([rows, audits]).includes(token), 'the token leaked into the DB row or an audit event');
  const github = rows.find((r) => r.key === 'github');
  assert.equal(github?.secretRef, `vault://${this.lastOrgId}/github`);
});

Then('{int} features were imported', function (this: GilgameshWorld, n: number) {
  assert.equal((this.response?.body as { imported: number }).imported, n);
});

// Slice 21 (AC-VUIH-01): the last integrations-list response flags the connected voyage key as
// inactive because the offline harness has no platform Voyage space (embeddings stay lexical).
Then(
  'the {string} integration reports the platform Voyage space as inactive',
  function (this: GilgameshWorld, key: string) {
    const item = (this.response?.body as { key: string; platformVoyageActive?: boolean }[]).find((i) => i.key === key);
    assert.ok(item, `no ${key} integration in the response`);
    assert.equal(item?.platformVoyageActive, false);
  },
);
