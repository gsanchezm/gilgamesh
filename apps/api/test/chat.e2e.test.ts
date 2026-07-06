import type { AgentRepository, MembershipRepository } from '@gilgamesh/application';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { TOKENS } from '../src/persistence/tokens';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'chat@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);

  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  orgId = proj.body.orgId;
  projectId = proj.body.projectId;
});

afterAll(async () => {
  await app.close();
});

const server = () => app.getHttpServer();
const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const read = (req: request.Test) => req.set('Cookie', auth.cookie);

const agentIdFor = async (slot: string) => {
  const agents = app.get<AgentRepository>(TOKENS.Agents);
  return (await agents.listForOrg(orgId)).find((a) => a.slot === slot)!.id;
};

async function createSession(body: Record<string, unknown> = {}): Promise<string> {
  const res = await mutate(request(server()).post(`/projects/${projectId}/chat`)).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('Agent Chat API', () => {
  it('requires authentication (401)', async () => {
    expect((await request(server()).post(`/projects/${projectId}/chat`).send({})).status).toBe(401);
    expect((await request(server()).get(`/chat/${randomUUID()}/events`)).status).toBe(401);
  });

  it('rejects a session create without the CSRF token (403)', async () => {
    const res = await read(request(server()).post(`/projects/${projectId}/chat`)).send({});
    expect(res.status).toBe(403);
  });

  it('creates a session; pins a catalog agent; rejects an unknown pin (201/201/422)', async () => {
    const plain = await mutate(request(server()).post(`/projects/${projectId}/chat`)).send({});
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({ projectId, agentId: null });

    const perf = await agentIdFor('perf');
    const pinned = await mutate(request(server()).post(`/projects/${projectId}/chat`)).send({ agentId: perf });
    expect(pinned.status).toBe(201);
    expect(pinned.body.agentId).toBe(perf);

    const bogus = await mutate(request(server()).post(`/projects/${projectId}/chat`)).send({ agentId: randomUUID() });
    expect(bogus.status).toBe(422);
  });

  it('a VIEWER cannot open a chat (403)', async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'V', lastName: 'R', email: 'viewer-chat@uruk.io', password: 'C0rrect-Horse!' });
    await app.get<MembershipRepository>(TOKENS.Memberships).create({
      id: randomUUID(),
      orgId,
      userId: reg.body.userId,
      role: 'VIEWER',
      createdAt: new Date(),
    });
    const viewer = authFrom(reg);
    const res = await request(server())
      .post(`/projects/${projectId}/chat`)
      .set('Cookie', viewer.cookie)
      .set('X-CSRF-Token', viewer.csrf)
      .send({});
    expect(res.status).toBe(403);
  });

  it('another tenant cannot reach my session (404, no existence leak)', async () => {
    const sessionId = await createSession();
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'N', lastName: 'O', email: 'owner@nippur.io', password: 'C0rrect-Horse!' });
    const foreign = authFrom(reg);
    await request(server())
      .post('/projects')
      .set('Cookie', foreign.cookie)
      .set('X-CSRF-Token', foreign.csrf)
      .send({ projectName: 'Nippur', format: 'BDD' });

    const res = await request(server())
      .post(`/chat/${sessionId}/messages`)
      .set('Cookie', foreign.cookie)
      .set('X-CSRF-Token', foreign.csrf)
      .send({ content: 'intrusion' });
    expect(res.status).toBe(404);
  });

  it('sends a message (201 = the persisted USER message) and replays events over SSE', async () => {
    const sessionId = await createSession();
    const sent = await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({
      content: 'hello pantheon',
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ sessionId, role: 'USER', content: 'hello pantheon', runId: null });

    const events = await read(request(server()).get(`/chat/${sessionId}/events`));
    expect(events.status).toBe(200);
    expect(String(events.headers['content-type'])).toContain('text/event-stream');
    expect(events.text).toContain('event: MESSAGE');
    expect(events.text).toContain('hello pantheon');
    expect(events.text).toContain('"role":"AGENT"');
    expect(events.text).toContain('event: DONE');
  });

  it('rejects a bad message body (422): missing content and oversized content', async () => {
    const sessionId = await createSession();
    expect((await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({})).status).toBe(422);
    expect(
      (await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({ content: 'x'.repeat(4001) }))
        .status,
    ).toBe(422);
  });

  it('C3 replays and closes unless live push is explicitly opted into (review S9)', async () => {
    const sessionId = await createSession();
    await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({ content: 'replay please' });

    // Even a text/event-stream client gets replay-and-close without ?live=1 — the opt-in is
    // explicit and proxy-proof, never sniffed from the Accept header.
    const events = await read(
      request(server()).get(`/chat/${sessionId}/events`).set('Accept', 'text/event-stream'),
    );
    expect(events.status).toBe(200);
    expect(events.text).toContain('replay please');
    expect(events.text).toContain('event: DONE');
  });

  it('C3 live: an SSE client stays open, gets live DELTA/MESSAGE/DONE, and unsubscribes on close (AC-SSE-01)', async () => {
    const sessionId = await createSession();
    const httpServer = server() as http.Server;
    if (!httpServer.address()) await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const { port } = httpServer.address() as AddressInfo;

    const chunks: string[] = [];
    let live!: http.ClientRequest;
    await new Promise<void>((resolve, reject) => {
      live = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/chat/${sessionId}/events?live=1`,
          headers: { accept: 'text/event-stream', cookie: auth.cookie },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.setEncoding('utf8');
          res.on('data', (c: string) => chunks.push(c));
          resolve(); // headers received => the server has already subscribed to the topic
        },
      );
      live.on('error', reject);
    });

    const transcript = () => chunks.join('');
    const until = async (pred: () => boolean) => {
      const start = Date.now();
      while (!pred()) {
        if (Date.now() - start > 5_000) throw new Error(`timed out; transcript so far: ${transcript()}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const sent = await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({
      content: 'hello live',
    });
    expect(sent.status).toBe(201);

    await until(() => transcript().includes('event: DONE'));
    const text = transcript();
    expect(text).toContain('"hello live"');
    expect(text).toContain('event: DELTA');
    expect(text).toContain('event: MESSAGE');
    expect(text).toContain('"role":"AGENT"');

    // Closing the client must unsubscribe — no handler leaked on the bus (AC-SSE-01).
    const bus = app.get(TOKENS.Events) as unknown as { handlers: Map<string, Set<unknown>> };
    expect(bus.handlers.get(`chat:${sessionId}`)?.size ?? 0).toBe(1);
    live.destroy();
    await until(() => (bus.handlers.get(`chat:${sessionId}`)?.size ?? 0) === 0);
  });

  it('a chat-triggered run rides the standard run path and narrates back (AC-CRUN-01/03)', async () => {
    const feat = await mutate(request(server()).post(`/projects/${projectId}/features`)).send({
      path: 'checkout.feature',
      content: 'Feature: Checkout\n  Scenario: Checkout case 1\n    When step 1\n  Scenario: Checkout case 2\n    When step 2\n',
    });
    expect(feat.status).toBe(201);

    const sessionId = await createSession();
    const sent = await mutate(request(server()).post(`/chat/${sessionId}/messages`)).send({
      content: 'run the Checkout feature',
    });
    expect(sent.status).toBe(201);

    const runs = await read(request(server()).get(`/projects/${projectId}/runs`));
    expect(runs.body.length).toBe(1);

    const events = await read(request(server()).get(`/chat/${sessionId}/events`));
    expect(events.text).toContain('"role":"SYSTEM"');
    expect(events.text).toContain('Checkout case 1');
    expect(events.text).toMatch(/PASS|FAIL/);
    expect(events.text).toContain(runs.body[0].id);
  });
});
