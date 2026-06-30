import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { authOf } from '../support/auth';
import type { GilgameshWorld } from '../support/world';

const DEFAULT_PASSWORD = 'C0rrect-Horse!';

// ---- helpers ------------------------------------------------------------------------

async function onboard(world: GilgameshWorld, projectName: string) {
  const res = await world
    .applyAuth(request(world.app.getHttpServer()).post(world.url('/projects')))
    .send({ projectName, format: 'BDD' });
  if (res.status === 201 && res.body?.projectId) {
    world.lastOrgId = res.body.orgId;
    world.lastProjectId = res.body.projectId;
    world.projectsByName.set(projectName, res.body.projectId);
  }
  world.response = res;
  return res;
}

async function patchPath(world: GilgameshWorld, path: string, body: Record<string, unknown>) {
  world.response = await world
    .applyAuth(request(world.app.getHttpServer()).patch(world.url(path)))
    .send(body);
  return world.response;
}

async function getRoom(world: GilgameshWorld) {
  const req = request(world.app.getHttpServer()).get(world.url('/projects/{id}/agents'));
  if (world.cookie) req.set('Cookie', world.cookie);
  world.response = await req.send();
  return world.response.body as { agents: AgentRow[]; kpis: Kpis };
}

interface AgentRow {
  slot: string;
  enabled: boolean;
  tool: string;
  status: string;
}
interface Kpis {
  total: number;
  active: number;
  idle: number;
  busy: number;
  byFamily: Record<string, number>;
}

/** The agent for `slot` from the last response — works for both a single-agent PATCH and a list GET. */
function agentView(world: GilgameshWorld, slot: string): AgentRow | undefined {
  const body = world.response?.body as { agents?: AgentRow[]; slot?: string } | undefined;
  if (body?.agents) return body.agents.find((a) => a.slot === slot);
  if (body?.slot === slot) return body as AgentRow;
  return undefined;
}

// ---- Background ---------------------------------------------------------------------

Given('I own an Org with a freshly onboarded Project {string}', async function (this: GilgameshWorld, name: string) {
  const res = await onboard(this, name);
  assert.equal(res.status, 201);
});

Given(
  'the Project has {int} seeded ToolBinding rows with {string} true',
  async function (this: GilgameshWorld, n: number, _field: string) {
    const bindings = await this.db.toolBinding.findMany({ where: { projectId: this.lastProjectId! } });
    assert.equal(bindings.length, n);
    assert.ok(bindings.every((b) => b.enabled), 'expected all seeded bindings enabled');
  },
);

// ---- List & status (AC-ROOM-01/02/03) ----------------------------------------------

Then('the body is a list of {int} {string} items', function (this: GilgameshWorld, n: number, _kind: string) {
  const agents = (this.response?.body?.agents ?? []) as AgentRow[];
  assert.equal(agents.length, n);
});

Then(
  'each item carries its ToolBinding {string} and {string} and a derived {string}',
  function (this: GilgameshWorld, _enabled: string, _tool: string, _status: string) {
    const agents = (this.response?.body?.agents ?? []) as AgentRow[];
    for (const a of agents) {
      assert.equal(typeof a.enabled, 'boolean');
      assert.equal(typeof a.tool, 'string');
      assert.equal(typeof a.status, 'string');
    }
  },
);

Given(
  // <enabled> is substituted unquoted (true/false).
  /^the agent in slot "([^"]+)" has ToolBinding "enabled" = (true|false)$/,
  async function (this: GilgameshWorld, slot: string, enabled: string) {
    this.notes.set('lastSlot', slot);
    await patchPath(this, `/projects/{id}/agents/${slot}`, { enabled: enabled === 'true' });
  },
);

Then('that agent\'s {string} is {string}', function (this: GilgameshWorld, _field: string, status: string) {
  const slot = this.notes.get('lastSlot') as string;
  assert.equal(agentView(this, slot)?.status, status);
});

Given('this slice runs no tests and there are no RunNode rows', function () {
  /* Documentary: slice 1 has no Run/RunNode models, so BUSY can never be derived. */
});

Then('no agent has {string} {string}', function (this: GilgameshWorld, _field: string, status: string) {
  const agents = (this.response?.body?.agents ?? []) as AgentRow[];
  assert.ok(!agents.some((a) => a.status === status), `an agent unexpectedly has status ${status}`);
});

Then('all {int} agents have {string} {string}', function (this: GilgameshWorld, n: number, _field: string, status: string) {
  const agents = (this.response?.body?.agents ?? []) as AgentRow[];
  assert.equal(agents.length, n);
  assert.ok(agents.every((a) => a.status === status), `not all agents have status ${status}`);
});

// ---- Sleep / wake / tool (AC-ROOM-04/05/06/07) -------------------------------------

When(
  'I PATCH {string} with a {string}:',
  async function (this: GilgameshWorld, path: string, _schema: string, table: DataTable) {
    const raw = table.hashes()[0] ?? {};
    const body: Record<string, unknown> = {};
    if ('enabled' in raw) body.enabled = raw.enabled === 'true';
    if ('tool' in raw) body.tool = raw.tool;
    await patchPath(this, path, body);
  },
);

When('I PATCH {string} with tool {string}', async function (this: GilgameshWorld, path: string, tool: string) {
  await patchPath(this, path, { tool });
});

When('I PATCH {string} with enabled {string}', async function (this: GilgameshWorld, path: string, enabled: string) {
  await patchPath(this, path, { enabled: enabled === 'true' });
});

Then('the {string} ToolBinding {string} is false', function (this: GilgameshWorld, slot: string, _field: string) {
  assert.equal(agentView(this, slot)?.enabled, false);
});

Then('the {string} agent {string} is {string}', function (this: GilgameshWorld, slot: string, _field: string, status: string) {
  assert.equal(agentView(this, slot)?.status, status);
});

Then('the {string} ToolBinding {string} is {string}', function (this: GilgameshWorld, slot: string, _field: string, tool: string) {
  assert.equal(agentView(this, slot)?.tool, tool);
});

Then(
  'the change persists when I GET {string} again',
  async function (this: GilgameshWorld, _path: string) {
    const room = await getRoom(this);
    const web = room.agents.find((a) => a.slot === 'web');
    assert.equal(web?.enabled, false);
  },
);

Then('the change persists across reload', async function (this: GilgameshWorld) {
  const room = await getRoom(this);
  assert.equal(room.agents.find((a) => a.slot === 'web')?.status, 'ACTIVE');
});

Given('the agent in slot {string} is asleep', async function (this: GilgameshWorld, slot: string) {
  await patchPath(this, `/projects/{id}/agents/${slot}`, { enabled: false });
});

Then(
  'the {string} ToolBinding {string} is unchanged',
  async function (this: GilgameshWorld, slot: string, _field: string) {
    const room = await getRoom(this);
    assert.notEqual(room.agents.find((a) => a.slot === slot)?.tool, 'Selenium');
  },
);

Then(
  'the {string} ToolBinding {string} remains {string}',
  async function (this: GilgameshWorld, slot: string, _field: string, fixedTool: string) {
    const room = await getRoom(this);
    assert.equal(room.agents.find((a) => a.slot === slot)?.tool, fixedTool);
  },
);

// ---- Wake-all (AC-ROOM-08/09) ------------------------------------------------------

When('I POST {string}', async function (this: GilgameshWorld, path: string) {
  this.response = await this.applyAuth(request(this.app.getHttpServer()).post(this.url(path))).send();
});

Given('{int} of the {int} agents are asleep', async function (this: GilgameshWorld, asleep: number, _total: number) {
  const slots = ['web', 'api', 'perf', 'sec', 'visual', 'a11y', 'android', 'ios', 'lead', 'arch', 'manual'];
  for (const slot of slots.slice(0, asleep)) {
    await patchPath(this, `/projects/{id}/agents/${slot}`, { enabled: false });
  }
});

Given('all {int} agents are already awake', function (_n: number) {
  /* A freshly onboarded project seeds all bindings enabled — nothing to do. */
});

Then('all {int} ToolBinding rows have {string} true', async function (this: GilgameshWorld, n: number, _field: string) {
  const room = await getRoom(this);
  assert.equal(room.agents.length, n);
  assert.ok(room.agents.every((a) => a.enabled), 'not all bindings enabled');
});

Then('the {int} ToolBinding rows are unchanged', async function (this: GilgameshWorld, n: number) {
  assert.equal(await this.db.toolBinding.count({ where: { projectId: this.lastProjectId! } }), n);
});

Then('no duplicate ToolBinding row is created for any agent', async function (this: GilgameshWorld) {
  const bindings = await this.db.toolBinding.findMany({ where: { projectId: this.lastProjectId! } });
  assert.equal(new Set(bindings.map((b) => b.agentId)).size, bindings.length);
});

Then('invoking {string} a second time produces the same result', async function (this: GilgameshWorld, _what: string) {
  const res = await this.applyAuth(
    request(this.app.getHttpServer()).post(this.url('/projects/{id}/agents/wake-all')),
  ).send();
  assert.equal(res.status, 200);
  assert.equal(await this.db.toolBinding.count({ where: { projectId: this.lastProjectId!, enabled: true } }), 11);
});

// ---- KPIs (AC-ROOM-10) --------------------------------------------------------------

Then('the KPIs show total agents {int}', function (this: GilgameshWorld, n: number) {
  assert.equal((this.response?.body?.kpis as Kpis)?.total, n);
});

Then('Active {int}, Idle {int} and Busy {int}', function (this: GilgameshWorld, active: number, idle: number, busy: number) {
  const k = this.response?.body?.kpis as Kpis;
  assert.deepEqual({ active: k.active, idle: k.idle, busy: k.busy }, { active, idle, busy });
});

Then(
  'the per-family distribution is proceso {int}, ui {int}, backend {int}, guardian {int}',
  function (this: GilgameshWorld, proceso: number, ui: number, backend: number, guardian: number) {
    assert.deepEqual((this.response?.body?.kpis as Kpis).byFamily, { proceso, ui, backend, guardian });
  },
);

When('I sleep the agents in slots {string} and {string}', async function (this: GilgameshWorld, a: string, b: string) {
  await patchPath(this, `/projects/{id}/agents/${a}`, { enabled: false });
  await patchPath(this, `/projects/{id}/agents/${b}`, { enabled: false });
});

Then('the KPIs show Active {int} and Idle {int}', async function (this: GilgameshWorld, active: number, idle: number) {
  const room = await getRoom(this);
  assert.deepEqual({ active: room.kpis.active, idle: room.kpis.idle }, { active, idle });
});

// ---- Tenant isolation & RBAC (AC-ROOM-11/12/13) ------------------------------------

Given(
  'a Project {string} belongs to a different Org I am not a member of',
  async function (this: GilgameshWorld, name: string) {
    const reg = await request(this.app.getHttpServer())
      .post(this.url('/auth/register'))
      .send({ firstName: 'F', lastName: 'O', email: 'foreigner@uruk.io', password: DEFAULT_PASSWORD });
    const auth = authOf(reg);
    const proj = await request(this.app.getHttpServer())
      .post(this.url('/projects'))
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ projectName: name, format: 'BDD' });
    this.projectsByName.set(name, proj.body.projectId);
  },
);

Then('no agent or ToolBinding data from the other Org is returned', function (this: GilgameshWorld) {
  assert.ok(!this.response?.body?.agents, 'foreign agent data leaked');
});

Given(
  'I am signed in as a {string} of the Org that owns {string}',
  async function (this: GilgameshWorld, role: string, _projectName: string) {
    const orgId = this.lastOrgId!;
    const reg = await request(this.app.getHttpServer())
      .post(this.url('/auth/register'))
      .send({ firstName: 'V', lastName: 'W', email: 'viewer@uruk.io', password: DEFAULT_PASSWORD });
    await this.db.membership.create({
      data: { id: randomUUID(), orgId, userId: reg.body.userId, role: role as never, createdAt: new Date() },
    });
    const auth = authOf(reg);
    this.cookie = auth.cookie;
    this.csrf = auth.csrf;
  },
);

Then('no AuditLog entry is recorded for a non-existent agent', async function (this: GilgameshWorld) {
  assert.equal(await this.db.auditLog.count({ where: { action: 'agent.enabled.changed' } }), 0);
});
