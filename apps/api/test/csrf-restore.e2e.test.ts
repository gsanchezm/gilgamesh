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

describe('CSRF cookie restore on GET /auth/me', () => {
  it('re-mints the csrf cookie so a session-restored user can still perform mutations', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ firstName: 'I', lastName: 'U', email: 'restore@uruk.io', password: 'C0rrect-Horse!' });
    const auth = authFrom(reg);

    // Simulate a browser restart: the persistent __Host- session cookie survives, but the
    // (formerly session-scoped) csrf cookie is gone.
    const sessionOnly = auth.cookie.split('; ').find((c) => c.startsWith('__Host-gg_session=')) ?? '';
    expect(sessionOnly).not.toBe('');

    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', sessionOnly);
    expect(me.status).toBe(200);

    // /auth/me must hand back a fresh csrf cookie for the double-submit.
    const reAuth = authFrom(me);
    expect(reAuth.csrf).toBeTruthy();

    // The restored session + the re-minted csrf token can now mutate (would be 403 without it).
    const create = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', `${sessionOnly}; ${reAuth.cookie}`)
      .set('X-CSRF-Token', reAuth.csrf)
      .send({ projectName: 'Restored', format: 'BDD' });
    expect(create.status).toBe(201);
  });
});
