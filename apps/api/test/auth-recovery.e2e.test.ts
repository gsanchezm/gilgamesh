import { createHash, randomUUID } from 'node:crypto';
import type { PasswordResetRepository, StubEmail } from '@gilgamesh/application';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { TOKENS } from '../src/persistence/tokens';

// Slice 12 — forgot/reset password over the Docker-free in-memory wiring (spec.md §8).
// The recorded-mail seam (TOKENS.Email -> StubEmail) is how tests obtain the raw token:
// the store only ever holds its sha256 hash.

let app: INestApplication;
let mail: StubEmail;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  mail = app.get(TOKENS.Email);
});

afterAll(async () => {
  await app.close();
});

const GENERIC = 'If an account exists for that email, a reset link is on its way.';

const user = (email: string) => ({
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email,
  password: 'C0rrect-Horse!',
});

const register = (email: string) => request(app.getHttpServer()).post('/auth/register').send(user(email));
const forgot = (email: string) => request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
const reset = (token: string, newPassword: string) =>
  request(app.getHttpServer()).post('/auth/reset-password').send({ token, newPassword });
const login = (email: string, password: string) =>
  request(app.getHttpServer()).post('/auth/login').send({ email, password });

function lastMailTo(email: string): { to: string; subject: string; text: string } {
  const mails = mail.sent.filter((m) => m.to === email);
  expect(mails.length).toBeGreaterThanOrEqual(1);
  return mails[mails.length - 1]!;
}

function tokenFrom(text: string): string {
  const raw = /[?&]token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  expect(raw).toBeTruthy();
  return raw!;
}

function sessionCookie(res: request.Response): string {
  const sc = res.headers['set-cookie'];
  const cookies = Array.isArray(sc) ? sc : [String(sc)];
  return cookies.find((c) => c.startsWith('__Host-gg_session'))!.split(';')[0]!;
}

describe('Auth recovery (public routes, no session required)', () => {
  it('answers the identical generic 202 for known and unknown emails (no enumeration)', async () => {
    await register('known@example.com');
    const known = await forgot('known@example.com');
    const unknown = await forgot('ghost@nowhere.test');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual({ message: GENERIC });
    expect(unknown.body).toEqual(known.body);
  });

  it('records a mail with a raw-token link for a real account, and none for an unknown one', async () => {
    await register('mailed@example.com');
    await forgot('mailed@example.com');
    const recorded = lastMailTo('mailed@example.com');
    expect(recorded.subject).toContain('password');
    expect(tokenFrom(recorded.text)).toBeTruthy();
    expect(mail.sent.some((m) => m.to === 'ghost@nowhere.test')).toBe(false);
  });

  it('rejects a missing/oversized email body (422) before any work', async () => {
    const res = await request(app.getHttpServer()).post('/auth/forgot-password').send({});
    expect(res.status).toBe(422);
  });

  it('happy path: reset changes the password, revokes sessions, consumes the token (204)', async () => {
    const email = 'happy@example.com';
    const registered = await register(email);
    const oldCookie = sessionCookie(registered);

    await forgot(email);
    const token = tokenFrom(lastMailTo(email).text);

    const res = await reset(token, 'N3w-Passphrase!!');
    expect(res.status).toBe(204);

    // Old session is dead (reset revokes ALL sessions).
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', oldCookie);
    expect(me.status).toBe(401);

    // Old password stops working; the new one signs in.
    expect((await login(email, 'C0rrect-Horse!')).status).toBe(401);
    expect((await login(email, 'N3w-Passphrase!!')).status).toBe(200);
  });

  it('a consumed token cannot be reused (422) and the reset password stays (single-use)', async () => {
    const email = 'reuse@example.com';
    await register(email);
    await forgot(email);
    const token = tokenFrom(lastMailTo(email).text);

    expect((await reset(token, 'N3w-Passphrase!!')).status).toBe(204);
    const replay = await reset(token, '0ther-Passphrase!');
    expect(replay.status).toBe(422);
    expect(replay.body.title).toBe('RESET_TOKEN_INVALID');
    expect((await login(email, 'N3w-Passphrase!!')).status).toBe(200);
  });

  it('an expired token is rejected (422) and the password is unchanged', async () => {
    const email = 'expired@example.com';
    const registered = await register(email);
    const userId = registered.body.userId as string;

    // Plant an already-expired row directly through the repository port (hash-only, like prod).
    const rawToken = 'expired-raw-token-fixture';
    const repo = app.get<PasswordResetRepository>(TOKENS.PasswordResets);
    await repo.create({
      id: randomUUID(),
      userId,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      expiresAt: new Date(Date.now() - 60_000),
      usedAt: null,
      createdAt: new Date(Date.now() - 31 * 60_000),
    });

    expect((await reset(rawToken, 'N3w-Passphrase!!')).status).toBe(422);
    expect((await login(email, 'C0rrect-Horse!')).status).toBe(200);
  });

  it('an unrecognized token is rejected (422)', async () => {
    const res = await reset('garbage-token', 'N3w-Passphrase!!');
    expect(res.status).toBe(422);
    expect(res.body.title).toBe('RESET_TOKEN_INVALID');
  });

  it('a weak newPassword is rejected (422) without consuming the token', async () => {
    const email = 'weakpass@example.com';
    await register(email);
    await forgot(email);
    const token = tokenFrom(lastMailTo(email).text);

    const weak = await reset(token, 'short');
    expect(weak.status).toBe(422);
    // A weak password is a DTO rejection (VALIDATION) — DISTINCT from a bad token
    // (RESET_TOKEN_INVALID) so the per-IP lockout can tell a fumble from an attack (slice 39 tuning).
    expect(weak.body.title).toBe('VALIDATION');
    // The token survived the rejected attempt and still works.
    expect((await reset(token, 'N3w-Passphrase!!')).status).toBe(204);
  });

  it('never leaks the raw token into the reset store (hash-only rows)', async () => {
    const email = 'hashed@example.com';
    await register(email);
    await forgot(email);
    const raw = tokenFrom(lastMailTo(email).text);
    const repo = app.get<PasswordResetRepository>(TOKENS.PasswordResets);
    expect(await repo.findByTokenHash(raw)).toBeNull(); // raw is NOT the stored key
    expect(await repo.findByTokenHash(createHash('sha256').update(raw).digest('hex'))).not.toBeNull();
  });
});
