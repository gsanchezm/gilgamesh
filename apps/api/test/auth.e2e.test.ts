import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { authFrom } from './support/auth';

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

describe('Logout (slice 18, AC-OUT-01/03/04)', () => {
  it('revokes the session server-side: 204, both cookies cleared, old cookie -> 401', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...valid, email: 'logout@example.com' });
    const auth = authFrom(reg);

    const out = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf);
    expect(out.status).toBe(204);

    // The response clears the __Host- session AND the csrf companion (matching attributes).
    const cleared = cookieHeader(out);
    expect(cleared).toContain('__Host-gg_session=;');
    expect(cleared).toContain('csrf=;');

    // AC-OUT-01/03: revocation is server-side, not just cookie hygiene — replaying the pre-logout
    // cookie is rejected by the session guard (revokedAt is set on the Session row).
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', auth.cookie);
    expect(me.status).toBe(401);
  });

  it('is CSRF-protected: logout without the double-submit token is rejected (403, AC-OUT-04)', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...valid, email: 'logout-csrf@example.com' });
    const auth = authFrom(reg);

    const out = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', auth.cookie);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('CSRF_FAILED');

    // The session survives the rejected logout attempt.
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', auth.cookie);
    expect(me.status).toBe(200);
  });
});
