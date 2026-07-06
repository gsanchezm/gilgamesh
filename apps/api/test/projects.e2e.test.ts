import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
});

async function signIn(email: string): Promise<Auth> {
  // Registration auto-signs-in and sets the session + csrf cookies.
  const res = await request(app.getHttpServer()).post('/auth/register').send({
    firstName: 'Ishtar',
    lastName: 'Uruk',
    email,
    password: 'C0rrect-Horse!',
  });
  return authFrom(res);
}

describe('Projects (onboarding)', () => {
  it('requires authentication (401)', async () => {
    const res = await request(app.getHttpServer()).post('/projects').send({ projectName: 'X', format: 'BDD' });
    expect(res.status).toBe(401);
  });

  it('bootstraps the tenant for the authenticated user (201)', async () => {
    const auth = await signIn('owner1@example.com');
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({
        orgName: 'Acme Inc.',
        projectName: 'OmniPizza Web',
        format: 'BDD',
        repoProvider: 'github',
      });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('omnipizza-web');
    expect(res.body.projectId).toBeTruthy();
    expect(res.body.orgId).toBeTruthy();
  });

  it('rejects an invalid format (422)', async () => {
    const auth = await signIn('owner2@example.com');
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send({ projectName: 'X', format: 'NOPE' });
    expect(res.status).toBe(422);
  });

  it('rejects a mutation without the CSRF token (403)', async () => {
    const auth = await signIn('owner3@example.com');
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', auth.cookie) // session cookie present, but no X-CSRF-Token header
      .send({ projectName: 'OmniPizza Web', format: 'BDD' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });
});
