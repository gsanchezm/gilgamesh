import type { MembershipRepository } from '@gilgamesh/application';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
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
    .send({ firstName: 'B', lastName: 'U', email: 'brain@uruk.io', password: 'C0rrect-Horse!' });
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

describe('Brain usage API (keystone v0.3 B1)', () => {
  it('requires authentication (401)', async () => {
    expect((await request(server()).get(`/orgs/${orgId}/brain/usage`)).status).toBe(401);
  });

  it('returns zeros before any brain call (AC-METER-03 edge)', async () => {
    const res = await read(request(server()).get(`/orgs/${orgId}/brain/usage`));
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    expect(res.body.byTier).toEqual([]);
    expect(res.body.bySurface).toEqual([]);
  });

  it('aggregates a GENERATE call after test-draft generation (AC-METER-02/03)', async () => {
    const gen = await mutate(request(server()).post(`/projects/${projectId}/test-cases/generate`)).send({
      prompt: 'a checkout flow with card and cash',
    });
    expect(gen.status).toBe(200);

    const res = await read(request(server()).get(`/orgs/${orgId}/brain/usage`));
    expect(res.status).toBe(200);
    expect(res.body.totals.calls).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.totals.inputTokens).toBe('number');
    expect(typeof res.body.totals.outputTokens).toBe('number');
    const generate = res.body.bySurface.find((s: { surface: string }) => s.surface === 'GENERATE');
    expect(generate).toBeTruthy();
    expect(generate.calls).toBeGreaterThanOrEqual(1);
    expect(res.body.byTier.find((t: { tier: string }) => t.tier === 'SONNET')).toBeTruthy();
  });

  it('a VIEWER may read the org usage (AC-METER-03)', async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'V', lastName: 'W', email: 'viewer-brain@uruk.io', password: 'C0rrect-Horse!' });
    await app.get<MembershipRepository>(TOKENS.Memberships).create({
      id: randomUUID(),
      orgId,
      userId: reg.body.userId,
      role: 'VIEWER',
      createdAt: new Date(),
    });
    const viewer = authFrom(reg);
    const res = await request(server()).get(`/orgs/${orgId}/brain/usage`).set('Cookie', viewer.cookie);
    expect(res.status).toBe(200);
  });

  it('a non-member gets 404 — no org existence leak (AC-METER-04)', async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'N', lastName: 'M', email: 'outsider-brain@uruk.io', password: 'C0rrect-Horse!' });
    const outsider = authFrom(reg);
    const res = await request(server()).get(`/orgs/${orgId}/brain/usage`).set('Cookie', outsider.cookie);
    expect(res.status).toBe(404);
  });
});
