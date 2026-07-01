import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProdAppModule } from '../../src/app.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { type Auth, authFrom } from '../support/auth';

/**
 * Exercises the Prisma-wired Test Lab adapters + the UnitOfWork transactional feature path against
 * real Postgres — the *.int.test.ts suite otherwise omits TestLabModule (the Prisma testlab repos
 * were covered only by the BDD sweep). Each run uses a unique email so it needs no truncation.
 */
let app: INestApplication;
let db: PrismaService;
let auth: Auth;
let projectId: string;
const base = '/api/v1';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [ProdAppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  db = app.get(PrismaService);

  const email = `testlab-int-${Date.now()}@example.com`;
  const reg = await request(app.getHttpServer())
    .post(`${base}/auth/register`)
    .send({ firstName: 'I', lastName: 'U', email, password: 'C0rrect-Horse!' });
  auth = authFrom(reg);
  const proj = await request(app.getHttpServer())
    .post(`${base}/projects`)
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: `Lab ${Date.now()}`, format: 'BDD' });
  projectId = proj.body.projectId;
});

afterAll(async () => {
  await app?.close();
});

const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const server = () => app.getHttpServer();

describe('Test Lab (Prisma · real Postgres)', () => {
  it('persists a slice, a parsed feature and a test case', async () => {
    const slice = await mutate(request(server()).post(`${base}/projects/${projectId}/slices`)).send({
      key: 'regression',
      name: 'Regression',
    });
    expect(slice.status).toBe(201);

    const feature = await mutate(request(server()).post(`${base}/projects/${projectId}/features`)).send({
      path: 'checkout.feature',
      content: 'Feature: Checkout\n  Scenario: Pay\n    When I pay\n  Scenario: Refund\n    When I refund\n',
      sliceId: slice.body.id,
    });
    expect(feature.status).toBe(201);
    expect(feature.body.scenarios.map((s: { name: string }) => s.name)).toEqual(['Pay', 'Refund']);

    // Scenarios are committed in the same transaction as the feature row.
    expect(await db.scenario.count({ where: { featureId: feature.body.id } })).toBe(2);

    const tc = await mutate(request(server()).post(`${base}/projects/${projectId}/test-cases`)).send({
      title: 'Pay with card',
      priority: 'HIGH',
      sliceId: slice.body.id,
    });
    expect(tc.status).toBe(201);
    expect(tc.body.key).toMatch(/^TC_/);

    // Deleting the feature cascades its scenarios in one transaction.
    const del = await mutate(request(server()).delete(`${base}/features/${feature.body.id}`)).send();
    expect(del.status).toBe(204);
    expect(await db.scenario.count({ where: { featureId: feature.body.id } })).toBe(0);

    // Deleting the slice detaches the test case (sliceId -> null), not deletes it.
    await mutate(request(server()).delete(`${base}/slices/${slice.body.id}`)).send();
    const persisted = await db.testCase.findUnique({ where: { id: tc.body.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.sliceId).toBeNull();
  });

  it('assigns distinct keys under concurrent creation — no unique-collision 500 (audit #7)', async () => {
    const N = 6;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        mutate(request(server()).post(`${base}/projects/${projectId}/test-cases`)).send({
          title: `Concurrent ${i}`,
          priority: 'LOW',
        }),
      ),
    );

    // The derive-key/insert race is absorbed by the CONFLICT retry: every request succeeds…
    expect(results.map((r) => r.status)).toEqual(Array(N).fill(201));
    // …and each lands on a distinct key (no duplicates, no lost writes).
    const keys = results.map((r) => r.body.key as string);
    expect(new Set(keys).size).toBe(N);
  });
});
