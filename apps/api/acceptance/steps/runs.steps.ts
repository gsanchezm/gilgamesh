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

// A feature whose scenario names drive the deterministic kernel: pass / fail / skip.
const PASS_FAIL_SKIP =
  'Feature: Checkout\n  Scenario: Pay with card\n    When pay\n  Scenario: Payment fails\n    When pay\n  Scenario: Refund wip\n    When refund\n';

When(
  'a feature {string} with scenarios that pass, fail and skip',
  async function (this: GilgameshWorld, path: string) {
    const res = await this.applyAuth(server(this).post(this.url('/projects/{id}/features'))).send({
      path,
      content: PASS_FAIL_SKIP,
    });
    assert.equal(res.status, 201, `feature ${path} -> ${res.status}`);
    this.notes.set('featureId', res.body.id);
  },
);

When('a test case {string}', async function (this: GilgameshWorld, title: string) {
  const res = await this.applyAuth(server(this).post(this.url('/projects/{id}/test-cases'))).send({
    title,
    priority: 'HIGH',
  });
  assert.equal(res.status, 201, `test case ${title} -> ${res.status}`);
  this.notes.set('testCaseId', res.body.id);
});

When('I trigger a run of that feature', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/runs'))).send({
    targetKind: 'FEATURE',
    targetId: this.notes.get('featureId'),
  });
  if (this.response.body?.id) this.notes.set('runId', this.response.body.id);
});

When('I trigger a run of that test case', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/runs'))).send({
    targetKind: 'TESTCASE',
    targetId: this.notes.get('testCaseId'),
  });
  if (this.response.body?.id) this.notes.set('runId', this.response.body.id);
});

When('I trigger a run of feature {string}', async function (this: GilgameshWorld, featureId: string) {
  this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/runs'))).send({
    targetKind: 'FEATURE',
    targetId: featureId,
  });
});

When('I read that run', async function (this: GilgameshWorld) {
  const id = this.notes.get('runId');
  this.response = await server(this).get(`${this.basePath}/runs/${id}`).set('Cookie', this.cookie ?? '');
});

When('I list the runs', async function (this: GilgameshWorld) {
  this.response = await server(this).get(this.url('/projects/{id}/runs')).set('Cookie', this.cookie ?? '');
});

Then('the run status is {string}', function (this: GilgameshWorld, status: string) {
  assert.equal(body(this).status, status);
});

Then(
  'the run totals are {int} passed, {int} failed, {int} skipped',
  function (this: GilgameshWorld, passed: number, failed: number, skipped: number) {
    assert.deepEqual(
      { passed: body(this).passed, failed: body(this).failed, skipped: body(this).skipped },
      { passed, failed, skipped },
    );
  },
);

Then('the run has {int} results', function (this: GilgameshWorld, n: number) {
  const results = (body(this).results ?? []) as unknown[];
  assert.equal(results.length, n);
});

Then('the runs list has {int} runs', function (this: GilgameshWorld, n: number) {
  const list = (this.response?.body ?? []) as unknown[];
  assert.equal(list.length, n);
});

// Slice-4 quota coverage: drive the org's run-minute usage directly via the DB.
When('the org has exhausted its run minutes', async function (this: GilgameshWorld) {
  await this.db.subscription.updateMany({
    where: { orgId: this.lastOrgId! },
    data: { runMinutesUsed: 1_000_000 },
  });
});

Then('the org has used at least {int} run minutes', async function (this: GilgameshWorld, n: number) {
  const sub = await this.db.subscription.findUnique({ where: { orgId: this.lastOrgId! } });
  assert.ok((sub?.runMinutesUsed ?? 0) >= n, `expected runMinutesUsed >= ${n}, got ${sub?.runMinutesUsed}`);
});
