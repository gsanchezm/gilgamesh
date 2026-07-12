import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;
let projectId: string;
let featureId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'runs@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);

  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  projectId = proj.body.projectId;

  const feat = await request(app.getHttpServer())
    .post(`/projects/${projectId}/features`)
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({
      path: 'checkout.feature',
      content:
        'Feature: Checkout\n  Scenario: Pay with card\n    When pay\n  Scenario: Payment fails\n    When pay\n  Scenario: Refund wip\n    When refund\n',
    });
  featureId = feat.body.id;
});

afterAll(async () => {
  await app.close();
});

const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const read = (req: request.Test) => req.set('Cookie', auth.cookie);
const server = () => app.getHttpServer();

describe('Test Execution API', () => {
  it('requires authentication', async () => {
    expect((await request(server()).get(`/projects/${projectId}/runs`)).status).toBe(401);
  });

  it('rejects a trigger without the CSRF token (403)', async () => {
    const res = await read(request(server()).post(`/projects/${projectId}/runs`)).send({
      targetKind: 'FEATURE',
      targetId: featureId,
    });
    expect(res.status).toBe(403);
  });

  it('triggers a feature run, aggregates results, and reads it back newest-first', async () => {
    const run = await mutate(request(server()).post(`/projects/${projectId}/runs`)).send({
      targetKind: 'FEATURE',
      targetId: featureId,
    });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ status: 'FAILED', passed: 1, failed: 1, skipped: 1, total: 3, ratePct: 33 });
    expect(run.body.results.map((r: { status: string }) => r.status)).toEqual(['PASS', 'FAIL', 'SKIP']);

    const got = await read(request(server()).get(`/runs/${run.body.id}`));
    expect(got.status).toBe(200);
    expect(got.body.results).toHaveLength(3);
    // Slice 43: the per-result view carries the keystone-v0.7 tool/discipline over the wire (the
    // Reports "Tools" card reads them). The stub kernel tags this feature's scenarios playwright/e2e.
    expect(
      got.body.results.map((r: { tool: string; discipline: string }) => ({ tool: r.tool, discipline: r.discipline })),
    ).toEqual([
      { tool: 'playwright', discipline: 'e2e' },
      { tool: 'playwright', discipline: 'e2e' },
      { tool: 'playwright', discipline: 'e2e' },
    ]);

    // A second run must sort ahead of the first (newest-first, deterministic tiebreaker).
    const run2 = await mutate(request(server()).post(`/projects/${projectId}/runs`)).send({
      targetKind: 'FEATURE',
      targetId: featureId,
    });
    const list = await read(request(server()).get(`/projects/${projectId}/runs`));
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    expect(list.body[0].id).toBe(run2.body.id);
    expect(list.body[1].id).toBe(run.body.id);
  });

  it('rejects a run for a missing target (404)', async () => {
    const res = await mutate(request(server()).post(`/projects/${projectId}/runs`)).send({
      targetKind: 'FEATURE',
      targetId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid targetKind (422)', async () => {
    const res = await mutate(request(server()).post(`/projects/${projectId}/runs`)).send({
      targetKind: 'NOPE',
      targetId: featureId,
    });
    expect(res.status).toBe(422);
  });
});
