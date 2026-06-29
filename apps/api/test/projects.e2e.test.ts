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

async function authedCookie(email: string): Promise<string> {
  // Registration auto-signs-in and sets the session cookie.
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'Ishtar', lastName: 'Uruk', email, password: 'C0rrect-Horse!' });
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [String(sc)]).map((c) => String(c).split(';')[0]).join('; ');
}

describe('Projects (onboarding)', () => {
  it('requires authentication (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/projects')
      .send({ projectName: 'X', format: 'BDD' });
    expect(res.status).toBe(401);
  });

  it('bootstraps the tenant for the authenticated user (201)', async () => {
    const cookie = await authedCookie('owner1@example.com');
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookie)
      .send({ projectName: 'OmniPizza Web', format: 'BDD', repoProvider: 'github' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('omnipizza-web');
    expect(res.body.projectId).toBeTruthy();
    expect(res.body.orgId).toBeTruthy();
  });

  it('rejects an invalid format (422)', async () => {
    const cookie = await authedCookie('owner2@example.com');
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', cookie)
      .send({ projectName: 'X', format: 'NOPE' });
    expect(res.status).toBe(422);
  });
});
