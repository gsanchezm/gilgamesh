import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

function body(world: GilgameshWorld): Record<string, unknown> {
  return (world.response?.body ?? {}) as Record<string, unknown>;
}

// ---- Project setup -------------------------------------------------------------------

Given(
  'I have a {word} project named {string}',
  async function (this: GilgameshWorld, format: string, name: string) {
    const res = await this.applyAuth(server(this).post(this.url('/projects'))).send({
      projectName: name,
      format,
    });
    assert.equal(res.status, 201, `onboarding ${name} -> ${res.status}`);
    this.lastProjectId = res.body.projectId as string;
    this.lastOrgId = res.body.orgId as string;
    this.projectsByName.set(name, res.body.projectId as string);
  },
);

Given(
  'another user {string} has a {word} project named {string}',
  async function (this: GilgameshWorld, email: string, format: string, name: string) {
    const mineCookie = this.cookie;
    const mineCsrf = this.csrf;
    const reg = await server(this)
      .post(this.url('/auth/register'))
      .send({ firstName: 'E', lastName: 'X', email, password: 'C0rrect-Horse!' });
    this.captureCookie(reg);
    const res = await this.applyAuth(server(this).post(this.url('/projects'))).send({ projectName: name, format });
    this.projectsByName.set(name, res.body.projectId as string);
    // Restore the primary user's session for subsequent steps.
    this.cookie = mineCookie;
    this.csrf = mineCsrf;
  },
);

Given('{string} is a viewer in my org', async function (this: GilgameshWorld, email: string) {
  const reg = await server(this)
    .post(this.url('/auth/register'))
    .send({ firstName: 'V', lastName: 'R', email, password: 'C0rrect-Horse!' });
  const user = await this.db.user.findUnique({ where: { email } });
  await this.db.membership.create({
    data: { id: randomUUID(), orgId: this.lastOrgId!, userId: user!.id, role: 'VIEWER', createdAt: new Date() },
  });
  // Sign in as the viewer (capture their cookie) for the next mutation attempt.
  this.captureCookie(reg);
});

// ---- Slices --------------------------------------------------------------------------

When(
  'I create a slice with key {string} named {string}',
  async function (this: GilgameshWorld, key: string, name: string) {
    this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/slices'))).send({ key, name });
    if (this.response.body?.id) this.notes.set('sliceId', this.response.body.id);
  },
);

When('I list the slices', async function (this: GilgameshWorld) {
  this.response = await server(this).get(this.url('/projects/{id}/slices')).set('Cookie', this.cookie ?? '');
});

When('I rename that slice to {string}', async function (this: GilgameshWorld, name: string) {
  const id = this.notes.get('sliceId');
  this.response = await this.applyAuth(server(this).patch(`${this.basePath}/slices/${id}`)).send({ name });
});

When('I delete that slice', async function (this: GilgameshWorld) {
  const id = this.notes.get('sliceId');
  this.response = await this.applyAuth(server(this).delete(`${this.basePath}/slices/${id}`)).send();
});

Then('the slice list includes key {string}', function (this: GilgameshWorld, key: string) {
  const list = (this.response?.body ?? []) as { key: string }[];
  assert.ok(list.some((s) => s.key === key), `slice "${key}" not in list`);
});

Then('the slice list excludes key {string}', function (this: GilgameshWorld, key: string) {
  const list = (this.response?.body ?? []) as { key: string }[];
  assert.ok(!list.some((s) => s.key === key), `slice "${key}" unexpectedly present`);
});

// ---- Features ------------------------------------------------------------------------

When(
  'I create a feature {string} with content:',
  async function (this: GilgameshWorld, path: string, content: string) {
    this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/features'))).send({ path, content });
    if (this.response.body?.id) this.notes.set('featureId', this.response.body.id);
  },
);

When('I read that feature', async function (this: GilgameshWorld) {
  const id = this.notes.get('featureId');
  this.response = await server(this).get(`${this.basePath}/features/${id}`).set('Cookie', this.cookie ?? '');
});

When("I replace that feature's content with:", async function (this: GilgameshWorld, content: string) {
  const id = this.notes.get('featureId');
  this.response = await this.applyAuth(server(this).patch(`${this.basePath}/features/${id}`)).send({ content });
});

When('I delete that feature', async function (this: GilgameshWorld) {
  const id = this.notes.get('featureId');
  this.response = await this.applyAuth(server(this).delete(`${this.basePath}/features/${id}`)).send();
});

Then('the feature scenarios are {string}', function (this: GilgameshWorld, names: string) {
  const scenarios = (body(this).scenarios ?? []) as { name: string }[];
  const expected = names.split(',').map((s) => s.trim());
  assert.deepEqual(scenarios.map((s) => s.name), expected);
});

Then('that feature has no scenarios in the database', async function (this: GilgameshWorld) {
  const id = this.notes.get('featureId') as string;
  const count = await this.db.scenario.count({ where: { featureId: id } });
  assert.equal(count, 0);
});

// ---- Test cases ----------------------------------------------------------------------

When(
  'I create a test case {string} with priority {string}',
  async function (this: GilgameshWorld, title: string, priority: string) {
    this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/test-cases'))).send({ title, priority });
    if (this.response.body?.id) this.notes.set('testCaseId', this.response.body.id);
  },
);

When(
  'I create a test case {string} with priority {string} assigned to a roster agent',
  async function (this: GilgameshWorld, title: string, priority: string) {
    const agent = await this.db.agent.findFirst({ where: { orgId: this.lastOrgId! } });
    this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/test-cases'))).send({
      title,
      priority,
      assignedAgentId: agent!.id,
    });
  },
);

When(
  'I create a test case {string} with priority {string} assigned to {string}',
  async function (this: GilgameshWorld, title: string, priority: string, agentId: string) {
    this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/test-cases'))).send({
      title,
      priority,
      assignedAgentId: agentId,
    });
  },
);

When('I list the test cases', async function (this: GilgameshWorld) {
  this.response = await server(this).get(this.url('/projects/{id}/test-cases')).set('Cookie', this.cookie ?? '');
});

Then('the test case key matches {string}', function (this: GilgameshWorld, pattern: string) {
  const key = body(this).key as string;
  assert.match(key, new RegExp(pattern));
});

Then('the response field {string} equals {string}', function (this: GilgameshWorld, field: string, value: string) {
  assert.equal(String((body(this) as Record<string, unknown>)[field]), value);
});

// ---- Generate ------------------------------------------------------------------------

When('I generate drafts from {string}', async function (this: GilgameshWorld, prompt: string) {
  this.response = await this.applyAuth(server(this).post(this.url('/projects/{id}/test-cases/generate'))).send({ prompt });
});

Then('the response has at least one draft', function (this: GilgameshWorld) {
  const b = body(this) as { features?: unknown[]; testCases?: unknown[] };
  assert.ok((b.features?.length ?? 0) + (b.testCases?.length ?? 0) >= 1, 'expected at least one draft');
});

Then('the project has {int} features in the database', async function (this: GilgameshWorld, n: number) {
  const count = await this.db.feature.count({ where: { projectId: this.lastProjectId! } });
  assert.equal(count, n);
});
