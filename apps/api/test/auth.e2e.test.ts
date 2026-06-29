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

const valid = {
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email: 'ishtar@example.com',
  password: 'C0rrect-Horse!',
};

function cookieHeader(res: request.Response): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [String(sc)]).join(';');
}

describe('Auth', () => {
  it('registers a new account (201) and sets a session cookie', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send(valid);
    expect(res.status).toBe(201);
    expect(res.body.userId).toBeTruthy();
    expect(cookieHeader(res)).toContain('__Host-gg_session');
  });

  it('rejects a duplicate email (409)', async () => {
    const email = 'dupe@example.com';
    await request(app.getHttpServer()).post('/auth/register').send({ ...valid, email });
    const res = await request(app.getHttpServer()).post('/auth/register').send({ ...valid, email });
    expect(res.status).toBe(409);
    expect(res.body.title).toBe('EMAIL_IN_USE');
  });

  it('rejects a weak password (422)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...valid, email: 'weak@example.com', password: 'short' });
    expect(res.status).toBe(422);
  });

  it('forbids unknown properties (422, anti mass-assignment)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...valid, email: 'x@example.com', role: 'OWNER' });
    expect(res.status).toBe(422);
  });

  it('logs in and sets a __Host- session cookie (200)', async () => {
    const email = 'login@example.com';
    await request(app.getHttpServer()).post('/auth/register').send({ ...valid, email });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'C0rrect-Horse!' });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeTruthy();
    expect(res.body.activeOrgId).toBeNull(); // no tenant until onboarding
    expect(cookieHeader(res)).toContain('__Host-gg_session');
  });

  it('rejects bad credentials (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'definitely-wrong' });
    expect(res.status).toBe(401);
    expect(res.body.title).toBe('INVALID_CREDENTIALS');
  });
});
