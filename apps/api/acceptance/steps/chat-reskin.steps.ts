import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

/**
 * Slice 11 (Chat re-skin) — steps for the v0.4 read routes:
 *   GET /projects/{id}/chat            (list ChatSessions newest-first, derived titles)
 *   GET /chat/{sessionId}/messages     (conversation history as JSON)
 * Session/message creation reuses the slice-8 steps in chat.steps.ts (harness convention: steps are
 * global across files; `chatSessionId`/`chatSessionIds` ride the world notes).
 */

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

interface OrgInfo {
  cookie: string;
  csrf: string;
}

interface SessionListItem {
  id: string;
  agentId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

function listedSessions(world: GilgameshWorld): SessionListItem[] {
  assert.ok(Array.isArray(world.response?.body), 'the session list response is not an array');
  return world.response!.body as SessionListItem[];
}

function firstListed(world: GilgameshWorld): SessionListItem {
  const rows = listedSessions(world);
  assert.ok(rows.length > 0, 'the session list is empty');
  return rows[0]!;
}

/** Resolve "first"/"second" against the ids captured by the "two chat sessions" Given. */
function createdSessionId(world: GilgameshWorld, ordinal: string): string {
  const ids = world.notes.get('chatSessionIds') as string[] | undefined;
  assert.ok(ids?.length, 'no chat sessions captured — use the "two chat sessions" Given first');
  const index = ordinal === 'first' ? 0 : 1;
  const id = ids[index];
  assert.ok(id, `no ${ordinal} session captured`);
  return id;
}

// ---- Listing (AC-CRS-01/02/06) ----------------------------------------------------------

When('I list the chat sessions for the project', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(server(this).get(this.url('/projects/{id}/chat')));
});

When(
  '{string} lists the chat sessions for the project',
  async function (this: GilgameshWorld, _email: string) {
    // The "is a viewer in my org" Given switches the acting cookie to that user (harness convention).
    this.response = await this.applyAuth(server(this).get(this.url('/projects/{id}/chat')));
  },
);

When(
  '{string} lists the chat sessions for my project',
  async function (this: GilgameshWorld, email: string) {
    const info = this.notes.get(`auth:${email}`) as OrgInfo | undefined;
    assert.ok(info, `no auth captured for ${email}`);
    this.response = await server(this)
      .get(this.url('/projects/{id}/chat'))
      .set('Cookie', info.cookie);
  },
);

Given(
  'I send the chat message {string} to the {word} session',
  async function (this: GilgameshWorld, content: string, ordinal: string) {
    const sessionId = createdSessionId(this, ordinal);
    const res = await this.applyAuth(
      server(this).post(`${this.basePath}/chat/${sessionId}/messages`),
    ).send({ content });
    assert.equal(res.status, 201, `send to the ${ordinal} session -> ${res.status}`);
  },
);

Then('the session list has {int} sessions', function (this: GilgameshWorld, count: number) {
  assert.equal(listedSessions(this).length, count);
});

Then(
  'the first listed session is the {word} session created',
  function (this: GilgameshWorld, ordinal: string) {
    assert.equal(firstListed(this).id, createdSessionId(this, ordinal));
  },
);

Then('the first listed session has title {string}', function (this: GilgameshWorld, title: string) {
  assert.equal(firstListed(this).title, title);
});

Then('the first listed session has a null title', function (this: GilgameshWorld) {
  assert.equal(firstListed(this).title, null);
});

Then(
  'the first listed session title is the first {int} characters of {string}',
  function (this: GilgameshWorld, length: number, content: string) {
    assert.equal(firstListed(this).title, content.slice(0, length));
  },
);

Then(
  'the first listed session is pinned to the {string} agent',
  async function (this: GilgameshWorld, slot: string) {
    const agent = await this.db.agent.findFirst({
      where: { orgId: this.lastOrgId!, slot: slot as never },
    });
    assert.ok(agent, `no "${slot}" agent in org ${this.lastOrgId}`);
    assert.equal(firstListed(this).agentId, agent.id);
  },
);

// ---- History (AC-CRS-03/04/05) ----------------------------------------------------------

When('I fetch the chat history for the session', async function (this: GilgameshWorld) {
  const sessionId = this.notes.get('chatSessionId') as string;
  assert.ok(sessionId, 'no chat session captured');
  this.response = await this.applyAuth(server(this).get(`${this.basePath}/chat/${sessionId}/messages`));
});

When('I fetch the chat history for an unknown session', async function (this: GilgameshWorld) {
  this.response = await this.applyAuth(
    server(this).get(`${this.basePath}/chat/${randomUUID()}/messages`),
  );
});

When(
  '{string} fetches the chat history for the session',
  async function (this: GilgameshWorld, _email: string) {
    // Acting cookie already switched by the viewer Given (harness convention).
    const sessionId = this.notes.get('chatSessionId') as string;
    this.response = await this.applyAuth(server(this).get(`${this.basePath}/chat/${sessionId}/messages`));
  },
);

When(
  '{string} fetches the chat history for my session',
  async function (this: GilgameshWorld, email: string) {
    const info = this.notes.get(`auth:${email}`) as OrgInfo | undefined;
    assert.ok(info, `no auth captured for ${email}`);
    const sessionId = this.notes.get('chatSessionId') as string;
    this.response = await server(this)
      .get(`${this.basePath}/chat/${sessionId}/messages`)
      .set('Cookie', info.cookie);
  },
);

Then(
  'the chat history is a USER message {string} followed by an AGENT answer',
  function (this: GilgameshWorld, content: string) {
    const body = this.response?.body as { role: string; content: string }[];
    assert.ok(Array.isArray(body), 'the history response is not an array');
    assert.ok(body.length >= 2, `expected >= 2 messages, got ${body.length}`);
    assert.equal(body[0]!.role, 'USER');
    assert.equal(body[0]!.content, content);
    assert.equal(body[1]!.role, 'AGENT');
    assert.ok(body[1]!.content.length > 0, 'empty AGENT answer');
  },
);
