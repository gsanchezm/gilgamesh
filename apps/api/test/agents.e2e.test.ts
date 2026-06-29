import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

async function setup(email: string): Promise<{ cookie: string; projectId: string }> {
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'Ishtar', lastName: 'Uruk', email, password: 'C0rrect-Horse!' });
  const sc = reg.headers['set-cookie'];
  const cookie = (Array.isArray(sc) ? sc : [String(sc)])
    .map((c) => String(c).split(';')[0])
    .join('; ');
  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', cookie)
    .send({ projectName: 'OmniPizza Web', format: 'BDD' });
  return { cookie, projectId: proj.body.projectId };
}

describe('Agents', () => {
  it('lists the 11 agents, all awake on a fresh project (200)', async () => {
    const { cookie, projectId } = await setup('a1@example.com');
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/agents`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(11);
    expect(res.body.kpis.awake).toBe(11);
    expect(res.body.agents[0].slot).toBe('lead');
  });

  it('requires authentication (401)', async () => {
    const { projectId } = await setup('a2@example.com');
    const res = await request(app.getHttpServer()).get(`/projects/${projectId}/agents`);
    expect(res.status).toBe(401);
  });

  it('changes a tool (200) and rejects a tool outside the role (422)', async () => {
    const { cookie, projectId } = await setup('a3@example.com');
    const ok = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/agents/web`)
      .set('Cookie', cookie)
      .send({ tool: 'Cypress' });
    expect(ok.status).toBe(200);
    expect(ok.body.tool).toBe('Cypress');

    const bad = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/agents/web`)
      .set('Cookie', cookie)
      .send({ tool: 'Selenium' });
    expect(bad.status).toBe(422);
    expect(bad.body.title).toBe('INVALID_TOOL');
  });

  it('wakes all agents (200)', async () => {
    const { cookie, projectId } = await setup('a4@example.com');
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/agents/wake-all`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ awake: 11, total: 11 });
  });

  it('hides the project from another tenant (404)', async () => {
    const { projectId } = await setup('a5@example.com');
    const { cookie: intruder } = await setup('intruder@example.com');
    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/agents`)
      .set('Cookie', intruder);
    expect(res.status).toBe(404);
  });
});
