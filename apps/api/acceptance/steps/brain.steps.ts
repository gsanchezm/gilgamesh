import type { AgentBrainPort } from '@gilgamesh/application';
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TOKENS } from '../../src/persistence/tokens';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

function integrationsPath(world: GilgameshWorld, key: string): string {
  return `${world.basePath}/orgs/${world.lastOrgId}/integrations/${key}`;
}

/** Patch the bound brain's stream to fail/emit ONCE, then self-restore (the app is shared across scenarios). */
function patchStreamOnce(world: GilgameshWorld, behavior: 'fail' | { emit: string }) {
  const brain = world.app.get(TOKENS.Brain) as AgentBrainPort;
  const original = brain.stream.bind(brain);
  brain.stream = function patched(req) {
    brain.stream = original;
    if (behavior === 'fail') {
      return (async function* () {
        throw new Error('synthetic brain outage');
        yield { delta: '' };
      })();
    }
    void req;
    return (async function* () {
      yield { delta: (behavior as { emit: string }).emit };
    })();
  };
}

/** The most recent AGENT answer of the current session (mirrors chat.steps). */
async function lastAgentMessage(world: GilgameshWorld) {
  const sessionId = world.notes.get('chatSessionId') as string;
  const msg = await world.db.chatMessage.findFirst({
    where: { sessionId, role: 'AGENT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(msg, `no AGENT message in session ${sessionId}`);
  return msg;
}

// ---- Provider selection (AC-BRAIN-*) --------------------------------------------------

Then('no network call left the process', function (this: GilgameshWorld) {
  // The harness runs BRAIN_MODE=offline; the bound brain must self-report the offline/stub mode.
  const brain = this.app.get(TOKENS.Brain) as { mode?: string };
  assert.equal(brain.mode, 'offline', `expected the offline stub selection, got mode=${brain.mode}`);
});

Given('the brain is wired to fail on the next answer', function (this: GilgameshWorld) {
  patchStreamOnce(this, 'fail');
});

Then('the chat narrates a brain-unavailable outcome', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this);
  assert.ok(/unavailable/i.test(msg.content), `no brain-unavailable narration: ${msg.content}`);
});

Then(
  'the session has a USER message {string} persisted',
  async function (this: GilgameshWorld, content: string) {
    const sessionId = this.notes.get('chatSessionId') as string;
    const user = await this.db.chatMessage.findFirst({ where: { sessionId, role: 'USER', content } });
    assert.ok(user, `USER message "${content}" not persisted`);
  },
);

// ---- BYOK (AC-BYOK-*) ------------------------------------------------------------------

When(
  'I connect the {string} integration with key {string}',
  async function (this: GilgameshWorld, key: string, apiKey: string) {
    this.notes.set('lastToken', apiKey);
    this.response = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({
      action: 'connect',
      token: apiKey,
    });
  },
);

When('I connect the {string} integration with an invalid key', async function (this: GilgameshWorld, key: string) {
  this.response = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({
    action: 'connect',
    token: 'invalid',
  });
});

Then(
  'the catalog lists {string} in group {string} as disconnected',
  async function (this: GilgameshWorld, key: string, group: string) {
    const res = await this.applyAuth(server(this).get(`${this.basePath}/orgs/${this.lastOrgId}/integrations`));
    const item = (res.body as { key: string; group: string; connected: boolean }[]).find((i) => i.key === key);
    assert.ok(item, `"${key}" is not in the integrations catalog`);
    assert.equal(item.group, group);
    assert.equal(item.connected, false);
  },
);

Then('the {string} integration is connected with a secretRef', async function (this: GilgameshWorld, key: string) {
  const row = await this.db.integration.findFirst({ where: { orgId: this.lastOrgId!, key } });
  assert.ok(row?.connected, `"${key}" is not connected`);
  assert.ok(row.secretRef, `"${key}" has no secretRef`);
});

Then(
  'the raw key {string} appears nowhere in the database or audit trail',
  async function (this: GilgameshWorld, apiKey: string) {
    const rows = await this.db.integration.findMany({ where: { orgId: this.lastOrgId! } });
    const audits = await this.db.auditLog.findMany({ where: { orgId: this.lastOrgId! } });
    assert.ok(!JSON.stringify([rows, audits]).includes(apiKey), 'the raw key leaked into a row or audit event');
  },
);

Given('the {string} integration is already connected', async function (this: GilgameshWorld, key: string) {
  const res = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({
    action: 'connect',
    token: 'sk-ant-valid-e2e',
  });
  assert.equal(res.status, 200, `connect ${key} -> ${res.status}`);
});

Given('{string} is a member in my org', async function (this: GilgameshWorld, email: string) {
  const reg = await server(this)
    .post(this.url('/auth/register'))
    .send({ firstName: 'M', lastName: 'B', email, password: 'C0rrect-Horse!' });
  const user = await this.db.user.findUnique({ where: { email } });
  const { randomUUID } = await import('node:crypto');
  await this.db.membership.create({
    data: { id: randomUUID(), orgId: this.lastOrgId!, userId: user!.id, role: 'MEMBER', createdAt: new Date() },
  });
  // Act as the member for the next step (harness convention, mirrors the viewer step).
  this.captureCookie(reg);
});

When(
  '{string} connects the {string} integration with key {string}',
  async function (this: GilgameshWorld, _email: string, key: string, apiKey: string) {
    this.response = await this.applyAuth(server(this).patch(integrationsPath(this, key))).send({
      action: 'connect',
      token: apiKey,
    });
  },
);

// ---- Metering (AC-METER-*) ---------------------------------------------------------------

Then(
  'my org has a BrainUsage row with surface {string} and tier {string}',
  async function (this: GilgameshWorld, surface: string, tier: string) {
    const row = await this.db.brainUsage.findFirst({
      where: { orgId: this.lastOrgId!, surface: surface as never, tier: tier as never },
    });
    assert.ok(row, `no BrainUsage row with surface=${surface} tier=${tier}`);
    assert.ok(row.inputTokens >= 0 && row.outputTokens > 0, 'usage row carries no token counts');
  },
);

Then('my org has no BrainUsage row with surface {string}', async function (this: GilgameshWorld, surface: string) {
  const n = await this.db.brainUsage.count({ where: { orgId: this.lastOrgId!, surface: surface as never } });
  assert.equal(n, 0, `expected no ${surface} usage rows, found ${n}`);
});

Then(
  'the usage view totals at least 1 call for surface {string}',
  function (this: GilgameshWorld, surface: string) {
    const body = this.response?.body as { bySurface?: { surface: string; calls: number }[] };
    const entry = body?.bySurface?.find((s) => s.surface === surface);
    assert.ok(entry && entry.calls >= 1, `usage view has no calls for surface ${surface}`);
  },
);

Then('the usage view carries input and output token totals', function (this: GilgameshWorld) {
  const totals = (this.response?.body as { totals?: { inputTokens: unknown; outputTokens: unknown } })?.totals;
  assert.equal(typeof totals?.inputTokens, 'number');
  assert.equal(typeof totals?.outputTokens, 'number');
});

When('{string} GETs {string}', async function (this: GilgameshWorld, _email: string, path: string) {
  // The named-user Given (viewer/member) already switched the acting cookie (harness convention).
  const req = server(this).get(this.url(path));
  if (this.cookie) req.set('Cookie', this.cookie);
  this.response = await req;
});

When('{string} GETs my org brain usage', async function (this: GilgameshWorld, email: string) {
  const info = this.notes.get(`auth:${email}`) as { cookie: string } | undefined;
  assert.ok(info, `no auth captured for ${email}`);
  this.response = await server(this)
    .get(`${this.basePath}/orgs/${this.lastOrgId}/brain/usage`)
    .set('Cookie', info.cookie);
});

// ---- Tool registry (AC-TOOL-*) -------------------------------------------------------------

Given(
  'the brain will emit an {string} tool call with no featureName',
  function (this: GilgameshWorld, tool: string) {
    patchStreamOnce(this, { emit: JSON.stringify({ tool }) });
  },
);

Given('the brain will emit a {string} tool call', function (this: GilgameshWorld, tool: string) {
  patchStreamOnce(this, { emit: JSON.stringify({ tool }) });
});

Then('the chat narrates an INVALID_ARGS outcome', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this);
  assert.ok(msg.content.includes('INVALID_ARGS'), `no INVALID_ARGS narration: ${msg.content}`);
});

Then('the last tool audit outcome is {string}', async function (this: GilgameshWorld, outcome: string) {
  const row = await this.db.auditLog.findFirst({
    where: { orgId: this.lastOrgId!, action: 'chat.tool.invoked' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(row, 'no chat.tool.invoked audit row');
  assert.equal((row.metadata as { outcome?: string }).outcome, outcome);
});

Then('no tool audit row was recorded', async function (this: GilgameshWorld) {
  const n = await this.db.auditLog.count({ where: { orgId: this.lastOrgId!, action: 'chat.tool.invoked' } });
  assert.equal(n, 0, `expected no tool audit rows, found ${n}`);
});

Then('the answer narrates that the tool is not available', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this);
  assert.ok(/not available/i.test(msg.content), `no refusal narration: ${msg.content}`);
});
