import type { SubscriptionRepository } from '@gilgamesh/application';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { TOKENS } from '../src/persistence/tokens';
import { type Auth, authFrom } from './support/auth';

/**
 * Slice 14 — AI token billing over the in-memory wiring (Docker-free): the per-plan allowance
 * gates GENERATE / knowledge EMBED surfaces with 402 and narrates the block in chat (never 402
 * there); SCALE is unlimited; the subscription view carries the token fields.
 */
let app: INestApplication;
let auth: Auth;
let orgId: string;
let projectId: string;
let subscriptions: SubscriptionRepository;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  subscriptions = app.get<SubscriptionRepository>(TOKENS.Subscriptions);

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'T', lastName: 'B', email: 'tokens@uruk.io', password: 'C0rrect-Horse!' });
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

async function setTokens(used: number, plan?: 'FREE' | 'SCALE') {
  // save() deliberately never persists the usage counters (review S14 #1); the in-memory
  // create() overwrites by orgId, so it doubles as the absolute-counter seeding path here.
  const sub = (await subscriptions.findByOrg(orgId))!;
  await subscriptions.create({ ...sub, ...(plan ? { plan } : {}), brainTokensUsed: used });
}

describe('AI token billing (AC-TOKB)', () => {
  it('the subscription view carries the seeded FREE allowance (AC-TOKB-01)', async () => {
    const res = await read(request(server()).get(`/orgs/${orgId}/subscription`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      brainTokensQuota: 100_000,
      brainTokensUsed: 0,
      brainTokensUnlimited: false,
    });
  });

  it('a generate charges the counter; a plan change remaps the quota preserving usage (AC-TOKB-01/03)', async () => {
    const gen = await mutate(request(server()).post(`/projects/${projectId}/test-cases/generate`)).send({
      prompt: 'checkout flow',
    });
    expect(gen.status).toBe(200);
    const after = await read(request(server()).get(`/orgs/${orgId}/subscription`));
    expect(after.body.brainTokensUsed).toBeGreaterThan(0);

    const changed = await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'STARTER' });
    expect(changed.status).toBe(200);
    expect(changed.body.brainTokensQuota).toBe(2_000_000);
    expect(changed.body.brainTokensUsed).toBe(after.body.brainTokensUsed);
  });

  it('an exhausted allowance blocks generate with 402 Problem (AC-TOKB-04)', async () => {
    await setTokens(2_000_000);
    const res = await mutate(request(server()).post(`/projects/${projectId}/test-cases/generate`)).send({
      prompt: 'checkout flow',
    });
    expect(res.status).toBe(402);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('an exhausted allowance blocks the org-attributed knowledge search and upload with 402 (AC-TOKB-04)', async () => {
    await setTokens(2_000_000);
    const search = await read(request(server()).get('/knowledge/search').query({ q: 'boundary analysis' }));
    expect(search.status).toBe(402);

    const upload = await mutate(request(server()).post(`/orgs/${orgId}/knowledge/documents`)).send({
      name: 'notes.md',
      type: 'md',
      content: '# Notes\n\nBoundary value analysis picks the edges of each equivalence class.',
    });
    expect(upload.status).toBe(402);
  });

  it('an exhausted allowance never 402s chat — the block is narrated (AC-TOKB-05)', async () => {
    await setTokens(2_000_000);
    const session = await mutate(request(server()).post(`/projects/${projectId}/chat`)).send({});
    expect(session.status).toBe(201);

    const send = await mutate(request(server()).post(`/chat/${session.body.id}/messages`)).send({
      content: 'hello pantheon',
    });
    expect(send.status).toBe(201);

    const events = await read(request(server()).get(`/chat/${session.body.id}/events`));
    expect(events.status).toBe(200);
    expect(events.text).toContain('token allowance');
  });

  it('SCALE is unlimited: a maxed-out counter never blocks (AC-TOKB-06)', async () => {
    await setTokens(1_000_000_000, 'SCALE');
    const res = await mutate(request(server()).post(`/projects/${projectId}/test-cases/generate`)).send({
      prompt: 'checkout flow',
    });
    expect(res.status).toBe(200);
    // Usage kept charging past the stored cap — metering never stops (only blocking is bypassed).
    const after = await read(request(server()).get(`/orgs/${orgId}/subscription`));
    expect(after.body.brainTokensUsed).toBeGreaterThan(1_000_000_000);
  });
});
