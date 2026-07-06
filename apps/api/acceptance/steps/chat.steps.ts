import { type AgentBrainPort, type KnowledgeChunkRepository } from '@gilgamesh/application';
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { TOKENS } from '../../src/persistence/tokens';
import { authOf } from '../support/auth';
import type { GilgameshWorld } from '../support/world';

const DEFAULT_PASSWORD = 'C0rrect-Horse!';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

interface OrgInfo {
  orgId: string;
  projectId: string;
  cookie: string;
  csrf: string;
  email: string;
}

// ---- helpers ------------------------------------------------------------------------

async function createSession(world: GilgameshWorld, body: Record<string, unknown>) {
  world.response = await world
    .applyAuth(server(world).post(world.url('/projects/{id}/chat')))
    .send(body);
  if (world.response.body?.id) world.notes.set('chatSessionId', world.response.body.id);
  return world.response;
}

async function sendMessage(world: GilgameshWorld, sessionId: string, content: string) {
  world.response = await world
    .applyAuth(server(world).post(`${world.basePath}/chat/${sessionId}/messages`))
    .send({ content });
  return world.response;
}

async function agentIdForSlot(world: GilgameshWorld, slot: string): Promise<string> {
  const agent = await world.db.agent.findFirst({ where: { orgId: world.lastOrgId!, slot: slot as never } });
  assert.ok(agent, `no "${slot}" agent in org ${world.lastOrgId}`);
  return agent.id;
}

/** Latest chat.message.sent audit row's metadata (routing observability). */
async function lastSentAudit(world: GilgameshWorld): Promise<Record<string, unknown>> {
  const row = await world.db.auditLog.findFirst({
    where: { action: 'chat.message.sent' },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(row, 'no chat.message.sent audit entry');
  return row.metadata as Record<string, unknown>;
}

/** The most recent AGENT answer of a session. */
async function lastAgentMessage(world: GilgameshWorld, sessionId: string) {
  const msg = await world.db.chatMessage.findFirst({
    where: { sessionId, role: 'AGENT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(msg, `no AGENT message in session ${sessionId}`);
  return msg;
}

/** Register (once) a second org via onboarding, WITHOUT clobbering the primary user's cookie. */
async function ensureOrg(world: GilgameshWorld, orgName: string, ownerEmail?: string): Promise<OrgInfo> {
  const key = `org:${orgName}`;
  if (world.notes.has(key)) return world.notes.get(key) as OrgInfo;
  const email = ownerEmail ?? `owner@${orgName.toLowerCase()}.io`;
  const reg = await server(world)
    .post(world.url('/auth/register'))
    .send({ firstName: 'Nin', lastName: 'Nippur', email, password: DEFAULT_PASSWORD });
  const auth = authOf(reg);
  const proj = await server(world)
    .post(world.url('/projects'))
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: orgName, format: 'BDD' });
  assert.equal(proj.status, 201, `onboarding second org ${orgName} -> ${proj.status}`);
  const info: OrgInfo = {
    orgId: proj.body.orgId as string,
    projectId: proj.body.projectId as string,
    cookie: auth.cookie,
    csrf: auth.csrf,
    email,
  };
  world.notes.set(key, info);
  world.notes.set(`auth:${email}`, info);
  return info;
}

/** Seed one knowledge chunk for an org with an explicit scope (slot key, 'shared' or null). */
async function seedChunk(world: GilgameshWorld, orgId: string, name: string, scope: string | null) {
  const knowledge = world.app.get(TOKENS.Knowledge) as KnowledgeChunkRepository;
  const brain = world.app.get(TOKENS.Brain) as AgentBrainPort;
  // Content overlaps the queries used by the retrieval scenarios so cosine similarity is non-zero.
  const content = `${name}: how should we test this area — curated reference guidance.`;
  const [embedding] = await brain.embed([content]);
  await knowledge.upsertMany([
    {
      id: `chat-kb-${name.toLowerCase()}`,
      orgId,
      documentId: null,
      source: name,
      headingPath: [name],
      section: name,
      content,
      embedding: embedding!,
      tokenEstimate: 12,
      scope,
    },
  ]);
}

// ---- Sessions (AC-CHAT-*) -------------------------------------------------------------

When('I create a chat session for the project', async function (this: GilgameshWorld) {
  await createSession(this, {});
});

Given('a chat session for the project', async function (this: GilgameshWorld) {
  const res = await createSession(this, {});
  assert.equal(res.status, 201, `chat session create -> ${res.status}`);
});

Given('two chat sessions for the project', async function (this: GilgameshWorld) {
  const ids: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const res = await createSession(this, {});
    assert.equal(res.status, 201, `chat session create -> ${res.status}`);
    ids.push(res.body.id as string);
  }
  this.notes.set('chatSessionIds', ids);
});

When('I create a chat session pinned to the {string} agent', async function (this: GilgameshWorld, slot: string) {
  await createSession(this, { agentId: await agentIdForSlot(this, slot) });
});

Given('a chat session pinned to the {string} agent', async function (this: GilgameshWorld, slot: string) {
  const res = await createSession(this, { agentId: await agentIdForSlot(this, slot) });
  assert.equal(res.status, 201, `pinned chat session create -> ${res.status}`);
});

When(
  'I create a chat session pinned to an agent that is not in my org catalog',
  async function (this: GilgameshWorld) {
    await createSession(this, { agentId: randomUUID() });
  },
);

When('{string} creates a chat session for the project', async function (this: GilgameshWorld, _email: string) {
  // The "is a viewer in my org" Given switches the acting cookie to that user (harness convention).
  await createSession(this, {});
});

Then('the session belongs to my org and the project', async function (this: GilgameshWorld) {
  const row = await this.db.chatSession.findUnique({ where: { id: this.response?.body?.id } });
  assert.ok(row, 'chat session not persisted');
  assert.equal(row.orgId, this.lastOrgId);
  assert.equal(row.projectId, this.lastProjectId);
});

Then('the session has no pinned agent', async function (this: GilgameshWorld) {
  const row = await this.db.chatSession.findUnique({ where: { id: this.response?.body?.id } });
  assert.equal(row?.agentId, null);
});

Then('the session is pinned to the {string} agent', async function (this: GilgameshWorld, slot: string) {
  const row = await this.db.chatSession.findUnique({ where: { id: this.response?.body?.id } });
  assert.equal(row?.agentId, await agentIdForSlot(this, slot));
});

When('I send the chat message {string}', async function (this: GilgameshWorld, content: string) {
  await sendMessage(this, this.notes.get('chatSessionId') as string, content);
});

When(
  'I send the chat message {string} to both sessions',
  async function (this: GilgameshWorld, content: string) {
    for (const id of this.notes.get('chatSessionIds') as string[]) {
      const res = await sendMessage(this, id, content);
      assert.equal(res.status, 201, `send -> ${res.status}`);
    }
  },
);

Then(
  'the session has a USER message {string} followed by an AGENT answer in the database',
  async function (this: GilgameshWorld, content: string) {
    const sessionId = this.notes.get('chatSessionId') as string;
    const msgs = await this.db.chatMessage.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    assert.ok(msgs.length >= 2, `expected >= 2 messages, got ${msgs.length}`);
    assert.equal(msgs[0]!.role, 'USER');
    assert.equal(msgs[0]!.content, content);
    assert.equal(msgs[1]!.role, 'AGENT');
    assert.ok(msgs[1]!.content.length > 0, 'empty AGENT answer');
  },
);

Given(
  'a second org {string} with owner {string} exists',
  async function (this: GilgameshWorld, orgName: string, email: string) {
    await ensureOrg(this, orgName, email);
  },
);

When('{string} sends a chat message to my session', async function (this: GilgameshWorld, email: string) {
  const info = this.notes.get(`auth:${email}`) as OrgInfo;
  assert.ok(info, `no auth captured for ${email}`);
  const sessionId = this.notes.get('chatSessionId') as string;
  this.response = await server(this)
    .post(`${this.basePath}/chat/${sessionId}/messages`)
    .set('Cookie', info.cookie)
    .set('X-CSRF-Token', info.csrf)
    .send({ content: 'intrusion attempt' });
});

Then('the org {string} has 0 chat messages in the database', async function (this: GilgameshWorld, orgName: string) {
  const info = this.notes.get(`org:${orgName}`) as OrgInfo;
  assert.ok(info, `org ${orgName} was never created`);
  assert.equal(await this.db.chatMessage.count({ where: { orgId: info.orgId } }), 0);
});

// ---- Routing (AC-ROUTE-*) ---------------------------------------------------------------

Then('the answering agent slot is {string}', async function (this: GilgameshWorld, slot: string) {
  const msg = await lastAgentMessage(this, this.notes.get('chatSessionId') as string);
  assert.ok(msg.agentId, 'AGENT message carries no agentId');
  const agent = await this.db.agent.findUnique({ where: { id: msg.agentId } });
  assert.equal(agent?.slot, slot);
});

Then('the message was classified via the brain at HAIKU tier', async function (this: GilgameshWorld) {
  const meta = await lastSentAudit(this);
  assert.equal(meta.routed, true, 'expected the message to have been routed');
  assert.equal(meta.tier, 'HAIKU');
});

Then('the brain was not asked to classify the message', async function (this: GilgameshWorld) {
  const meta = await lastSentAudit(this);
  assert.equal(meta.routed, false, 'expected routing to be skipped for a pinned session');
});

Given('the {string} agent is disabled in the project', async function (this: GilgameshWorld, slot: string) {
  const res = await this.applyAuth(
    server(this).patch(this.url(`/projects/{id}/agents/${slot}`)),
  ).send({ enabled: false });
  assert.equal(res.status, 200, `disable ${slot} -> ${res.status}`);
});

Then('both AGENT answers are identical', async function (this: GilgameshWorld) {
  const [a, b] = this.notes.get('chatSessionIds') as string[];
  const first = await lastAgentMessage(this, a!);
  const second = await lastAgentMessage(this, b!);
  assert.ok(first.content.length > 0, 'empty first answer');
  assert.equal(first.content, second.content);
});

// ---- Scoped retrieval (AC-RET-*) ----------------------------------------------------------

Given(
  'my org has a knowledge chunk {string} scoped to {string}',
  async function (this: GilgameshWorld, name: string, scope: string) {
    await seedChunk(this, this.lastOrgId!, name, scope);
  },
);

Given('my org has a knowledge chunk {string} with no scope', async function (this: GilgameshWorld, name: string) {
  await seedChunk(this, this.lastOrgId!, name, null);
});

Given(
  'a second org {string} has a knowledge chunk {string} scoped to {string}',
  async function (this: GilgameshWorld, orgName: string, name: string, scope: string) {
    const info = await ensureOrg(this, orgName);
    await seedChunk(this, info.orgId, name, scope);
  },
);

Then("the answer's retrieved grounding includes {string}", async function (this: GilgameshWorld, name: string) {
  const msg = await lastAgentMessage(this, this.notes.get('chatSessionId') as string);
  assert.ok(msg.content.includes(name), `answer does not cite "${name}": ${msg.content}`);
});

Then(
  "the answer's retrieved grounding does not include {string}",
  async function (this: GilgameshWorld, name: string) {
    const msg = await lastAgentMessage(this, this.notes.get('chatSessionId') as string);
    assert.ok(!msg.content.includes(name), `answer unexpectedly cites "${name}": ${msg.content}`);
  },
);

// ---- Tool-called runs & authoring (AC-CRUN-*) ---------------------------------------------

Given(
  'the project has a feature {string} with {int} scenarios',
  async function (this: GilgameshWorld, name: string, n: number) {
    const scenarios = Array.from(
      { length: n },
      (_, i) => `  Scenario: ${name} case ${i + 1}\n    When step ${i + 1}\n`,
    ).join('');
    const res = await this.applyAuth(server(this).post(this.url('/projects/{id}/features'))).send({
      path: `${name.toLowerCase()}.feature`,
      content: `Feature: ${name}\n${scenarios}`,
    });
    assert.equal(res.status, 201, `feature create -> ${res.status}`);
    this.notes.set('featureId', res.body.id);
    this.notes.set('featureName', name);
  },
);

Then('a Run exists for the project created via the standard trigger path', async function (this: GilgameshWorld) {
  const run = await this.db.run.findFirst({ where: { projectId: this.lastProjectId! } });
  assert.ok(run, 'no Run persisted');
  assert.equal(run.trigger, 'MANUAL');
  assert.equal(run.targetKind, 'FEATURE');
  assert.equal(run.targetId, this.notes.get('featureId'));
  this.notes.set('runId', run.id);
});

Then('the triggering chat message has its runId set', async function (this: GilgameshWorld) {
  const sessionId = this.notes.get('chatSessionId') as string;
  const trigger = await this.db.chatMessage.findFirst({
    where: { sessionId, role: 'USER' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(trigger, 'no USER message found');
  assert.equal(trigger.runId, this.notes.get('runId'));
});

Then('the run trigger is audited', async function (this: GilgameshWorld) {
  const n = await this.db.auditLog.count({ where: { action: 'run.created', orgId: this.lastOrgId! } });
  assert.ok(n >= 1, 'run.created audit entry missing');
});

Given("my org's subscription has no executions remaining", async function (this: GilgameshWorld) {
  await this.db.subscription.updateMany({
    where: { orgId: this.lastOrgId! },
    data: { runMinutesUsed: 1_000_000 },
  });
});

Then('no Run is persisted for the project', async function (this: GilgameshWorld) {
  assert.equal(await this.db.run.count({ where: { projectId: this.lastProjectId! } }), 0);
});

Then('the chat narrates a QUOTA_EXCEEDED outcome', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this, this.notes.get('chatSessionId') as string);
  assert.ok(msg.content.includes('QUOTA_EXCEEDED'), `no quota narration: ${msg.content}`);
});

Then("the chat event stream narrates the run's events", async function (this: GilgameshWorld) {
  const sessionId = this.notes.get('chatSessionId') as string;
  const req = server(this).get(`${this.basePath}/chat/${sessionId}/events`);
  if (this.cookie) req.set('Cookie', this.cookie);
  const res = await req;
  assert.equal(res.status, 200, `events stream -> ${res.status}`);
  assert.ok(
    String(res.headers['content-type']).startsWith('text/event-stream'),
    `unexpected content-type ${res.headers['content-type']}`,
  );
  const name = this.notes.get('featureName') as string;
  assert.ok(res.text.includes(`${name} case 1`), `stream does not narrate "${name} case 1": ${res.text}`);
  assert.ok(/PASS|FAIL/.test(res.text), 'stream carries no result narration');
});

Then('the run summary persists as a SYSTEM message linked to the run', async function (this: GilgameshWorld) {
  const sessionId = this.notes.get('chatSessionId') as string;
  const sys = await this.db.chatMessage.findFirst({ where: { sessionId, role: 'SYSTEM' } });
  assert.ok(sys, 'no SYSTEM message persisted');
  assert.ok(sys.runId, 'SYSTEM message not linked to a run');
});

Then(
  'a TestCase exists in the project created via the standard authoring path',
  async function (this: GilgameshWorld) {
    const tc = await this.db.testCase.findFirst({ where: { projectId: this.lastProjectId! } });
    assert.ok(tc, 'no TestCase persisted');
    assert.ok(tc.key.startsWith('TC_'), `unexpected key ${tc.key}`);
  },
);

Then('the test case creation is audited', async function (this: GilgameshWorld) {
  const n = await this.db.auditLog.count({ where: { action: 'testcase.created', orgId: this.lastOrgId! } });
  assert.ok(n >= 1, 'testcase.created audit entry missing');
});
