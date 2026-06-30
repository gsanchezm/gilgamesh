import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;
let projectId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'lab@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);

  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  projectId = proj.body.projectId;
});

afterAll(async () => {
  await app.close();
});

const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const read = (req: request.Test) => req.set('Cookie', auth.cookie);
const server = () => app.getHttpServer();

describe('Test Lab API', () => {
  it('requires authentication', async () => {
    const res = await request(server()).get(`/projects/${projectId}/slices`);
    expect(res.status).toBe(401);
  });

  it('creates, lists and updates slices', async () => {
    const created = await mutate(request(server()).post(`/projects/${projectId}/slices`)).send({
      key: 'regression',
      name: 'Regression',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'regression', name: 'Regression' });

    const list = await read(request(server()).get(`/projects/${projectId}/slices`));
    expect(list.body.map((s: { key: string }) => s.key)).toContain('regression');

    const patched = await mutate(request(server()).patch(`/slices/${created.body.id}`)).send({ name: 'Regression v2' });
    expect(patched.body.name).toBe('Regression v2');
  });

  it('creates a feature and parses its scenarios; rejects invalid gherkin', async () => {
    const content = 'Feature: Checkout\n  Scenario: Pay\n    When I pay\n  Scenario: Refund\n    When I refund\n';
    const created = await mutate(request(server()).post(`/projects/${projectId}/features`)).send({
      path: 'checkout.feature',
      content,
    });
    expect(created.status).toBe(201);
    expect(created.body.scenarios.map((s: { name: string }) => s.name)).toEqual(['Pay', 'Refund']);

    const got = await read(request(server()).get(`/features/${created.body.id}`));
    expect(got.body.scenarios).toHaveLength(2);

    const bad = await mutate(request(server()).post(`/projects/${projectId}/features`)).send({
      path: 'bad.feature',
      content: 'no feature here',
    });
    expect(bad.status).toBe(422);
  });

  it('creates a test case with an auto key; rejects a bad priority', async () => {
    const created = await mutate(request(server()).post(`/projects/${projectId}/test-cases`)).send({
      title: 'Pay with card',
      priority: 'HIGH',
    });
    expect(created.status).toBe(201);
    expect(created.body.key).toMatch(/^TC_/);
    expect(created.body.status).toBe('NOTRUN');

    const bad = await mutate(request(server()).post(`/projects/${projectId}/test-cases`)).send({
      title: 'X',
      priority: 'URGENT',
    });
    expect(bad.status).toBe(422);
  });

  it('generates drafts (200) without persisting', async () => {
    const before = await read(request(server()).get(`/projects/${projectId}/features`));
    const gen = await mutate(request(server()).post(`/projects/${projectId}/test-cases/generate`)).send({
      prompt: 'a checkout flow',
      count: 2,
    });
    expect(gen.status).toBe(200);
    expect(gen.body.features.length + gen.body.testCases.length).toBeGreaterThan(0);

    // Generation persists nothing — the feature count is unchanged.
    const after = await read(request(server()).get(`/projects/${projectId}/features`));
    expect(after.body.length).toBe(before.body.length);
  });

  it('rejects a mutation without the CSRF token (403)', async () => {
    const res = await request(server())
      .post(`/projects/${projectId}/slices`)
      .set('Cookie', auth.cookie)
      .send({ key: 'nocsrf', name: 'No CSRF' });
    expect(res.status).toBe(403);
  });
});
