import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;
let orgId: string;
let projectId: string;

const TOKEN = 'ghp_super_secret_value_123';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'integrations@uruk.io', password: 'C0rrect-Horse!' });
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

const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const read = (req: request.Test) => req.set('Cookie', auth.cookie);
const server = () => app.getHttpServer();

describe('Integrations API', () => {
  it('requires authentication', async () => {
    expect((await request(server()).get(`/orgs/${orgId}/integrations`)).status).toBe(401);
  });

  it('lists the SOURCE_REPOS + AI_PROVIDERS catalog, disconnected initially (AC-INT-01, AC-BYOK-01, AC-VBYOK-01)', async () => {
    const res = await read(request(server()).get(`/orgs/${orgId}/integrations`));
    expect(res.status).toBe(200);
    expect(res.body.map((i: { key: string }) => i.key)).toEqual([
      'github',
      'gitlab',
      'bitbucket',
      'ado_repos',
      'anthropic',
      'voyage',
    ]);
    expect(res.body.every((i: { connected: boolean }) => i.connected === false)).toBe(true);
    expect(res.body.find((i: { key: string }) => i.key === 'anthropic').group).toBe('AI_PROVIDERS');
    expect(res.body.find((i: { key: string }) => i.key === 'voyage').group).toBe('AI_PROVIDERS');
  });

  it('connects the anthropic BYOK key through the same mutator (AC-BYOK-02/03)', async () => {
    const key = 'sk-ant-unit-test-key';
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/anthropic`)).send({
      action: 'connect',
      token: key,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'anthropic', group: 'AI_PROVIDERS', connected: true });
    expect(JSON.stringify(res.body)).not.toContain(key);

    const off = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/anthropic`)).send({
      action: 'disconnect',
    });
    expect(off.status).toBe(200);
    expect(off.body.connected).toBe(false);
  });

  it('rejects an anthropic key the verifier refuses (422, AC-BYOK-02)', async () => {
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/anthropic`)).send({
      action: 'connect',
      token: 'invalid',
    });
    expect(res.status).toBe(422);
  });

  it('connects the voyage BYOK key through the same mutator (AC-VBYOK-02/03)', async () => {
    const key = 'pa-voyage-unit-test-key';
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/voyage`)).send({
      action: 'connect',
      token: key,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'voyage', group: 'AI_PROVIDERS', connected: true });
    expect(JSON.stringify(res.body)).not.toContain(key);
    // S21 (AC-VUIH-01): the offline harness has no platform Voyage space, so a connected key is gated.
    expect(res.body.platformVoyageActive).toBe(false);

    const off = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/voyage`)).send({
      action: 'disconnect',
    });
    expect(off.status).toBe(200);
    expect(off.body.connected).toBe(false);
  });

  it('flags the voyage row inactive in the list over a lexical platform space (S21, AC-VUIH-01/04)', async () => {
    await mutate(request(server()).patch(`/orgs/${orgId}/integrations/voyage`)).send({
      action: 'connect',
      token: 'pa-voyage-list-key',
    });
    const list = await read(request(server()).get(`/orgs/${orgId}/integrations`));
    const rows = list.body as { key: string; platformVoyageActive?: boolean }[];
    expect(rows.find((i) => i.key === 'voyage')?.platformVoyageActive).toBe(false);
    // The flag is scoped to the voyage row — anthropic and source repos never carry it.
    expect(rows.find((i) => i.key === 'anthropic')?.platformVoyageActive).toBeUndefined();
    expect(rows.find((i) => i.key === 'github')?.platformVoyageActive).toBeUndefined();
    await mutate(request(server()).patch(`/orgs/${orgId}/integrations/voyage`)).send({ action: 'disconnect' });
  });

  it('rejects a voyage key the verifier refuses (422, AC-VBYOK-02)', async () => {
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/voyage`)).send({
      action: 'connect',
      token: 'invalid',
    });
    expect(res.status).toBe(422);
  });

  it('rejects import before a repo is connected (AC-INT-08)', async () => {
    const res = await mutate(request(server()).post(`/projects/${projectId}/repo/import`)).send({ fullName: 'acme/web-app', branch: 'main' });
    expect(res.status).toBe(422);
  });

  it('rejects connect without the CSRF token (403)', async () => {
    const res = await read(request(server()).patch(`/orgs/${orgId}/integrations/github`)).send({ action: 'connect', token: TOKEN });
    expect(res.status).toBe(403);
  });

  it('rejects an empty token (422, AC-INT-03)', async () => {
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/github`)).send({ action: 'connect', token: '   ' });
    expect(res.status).toBe(422);
  });

  it('connects without leaking the token (AC-INT-02/09)', async () => {
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/github`)).send({ action: 'connect', token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: 'github', connected: true });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);

    const list = await read(request(server()).get(`/orgs/${orgId}/integrations`));
    expect(list.body.find((i: { key: string }) => i.key === 'github').connected).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(TOKEN);
  });

  it('imports .feature files from the connected repo (AC-INT-06)', async () => {
    const res = await mutate(request(server()).post(`/projects/${projectId}/repo/import`)).send({ fullName: 'acme/web-app', branch: 'main' });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(2);

    const features = await read(request(server()).get(`/projects/${projectId}/features`));
    expect(features.body.length).toBeGreaterThanOrEqual(2);
  });

  it('disconnects (AC-INT-04)', async () => {
    const res = await mutate(request(server()).patch(`/orgs/${orgId}/integrations/github`)).send({ action: 'disconnect' });
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });
});
