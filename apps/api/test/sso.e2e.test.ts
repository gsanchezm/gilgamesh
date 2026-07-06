import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { UserRepository } from '@gilgamesh/application';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { TOKENS } from '../src/persistence/tokens';

// Deterministic stub vocabulary (SSO_MODE=offline via test/setup.ts).
const STUB_CODE = 'stub-sso-ok';
const STUB_UNVERIFIED_CODE = 'stub-sso-unverified';
const STUB_EMAIL = 'sso.stub@gilgamesh.test';
const STUB_UNVERIFIED_EMAIL = 'sso.unverified@gilgamesh.test';

const ORIGINAL_REDIS = process.env.REDIS_URL;

let app: INestApplication;

beforeAll(async () => {
  // Pin the in-memory state store regardless of ambient env, so a shell-wide REDIS_URL can't
  // make this Docker-free suite depend on a live Redis (same guard as rate-limit.e2e.test.ts).
  delete process.env.REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  if (ORIGINAL_REDIS === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS;
});

function cookieHeader(res: request.Response): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : sc ? [String(sc)] : []).join(';');
}

/** Runs /start and returns the state the stub embedded in the authorize URL. */
async function startSso(): Promise<string> {
  const res = await request(app.getHttpServer()).get('/auth/sso/google/start');
  expect(res.status).toBe(302);
  const state = new URL(res.headers.location!).searchParams.get('state');
  expect(state).toBeTruthy();
  return state!;
}

function callback(code: string, state: string) {
  return request(app.getHttpServer())
    .get('/auth/sso/google/callback')
    .query({ code, state });
}

describe('SSO / Google login (slice 15, stub mode)', () => {
  it('start 302-redirects to the IdP authorize URL carrying state and nonce, no session cookie (AC-SSO-01)', async () => {
    const res = await request(app.getHttpServer()).get('/auth/sso/google/start');
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location!);
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(cookieHeader(res)).not.toContain('__Host-gg_session');
  });

  it('registers a NEW user (unusable password), sets the session+csrf cookies and 302s to /onboarding (AC-SSO-03)', async () => {
    const state = await startSso();
    const res = await callback(STUB_CODE, state);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/onboarding');
    const cookies = cookieHeader(res);
    expect(cookies).toContain('__Host-gg_session');
    expect(cookies).toContain('csrf=');

    // The minted session authenticates /auth/me.
    const sessionPair = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0] ?? '')
      .filter((c) => c.startsWith('__Host-gg_session') || c.startsWith('csrf='))
      .join('; ');
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', sessionPair);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(STUB_EMAIL);

    // The created user's passwordHash is a REAL Argon2id hash of a discarded secret — the fixed
    // stub profile can never be logged into with a password.
    const users = app.get<UserRepository>(TOKENS.Users);
    const user = await users.findByEmail(STUB_EMAIL);
    expect(user).toBeTruthy();
    expect(user!.passwordHash.startsWith('$argon2')).toBe(true);
    const pwLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: STUB_EMAIL, password: 'anything-at-all-1234' });
    expect(pwLogin.status).toBe(401);
  });

  it('signs in the EXISTING user on the second SSO round-trip and 302s to / (AC-SSO-02)', async () => {
    const users = app.get<UserRepository>(TOKENS.Users);
    const before = await users.findByEmail(STUB_EMAIL);
    expect(before).toBeTruthy(); // created by the previous test

    const state = await startSso();
    const res = await callback(STUB_CODE, state);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(cookieHeader(res)).toContain('__Host-gg_session');
    const after = await users.findByEmail(STUB_EMAIL);
    expect(after!.id).toBe(before!.id); // no second user
  });

  it('rejects a forged state with 302 /login?sso=failed and no cookie (AC-SSO-04)', async () => {
    const res = await callback(STUB_CODE, 'forged-state');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=failed');
    expect(cookieHeader(res)).not.toContain('__Host-gg_session');
  });

  it('rejects a replayed state — single use (AC-SSO-04)', async () => {
    const state = await startSso();
    const first = await callback(STUB_CODE, state);
    expect(first.status).toBe(302);
    expect(first.headers.location).not.toContain('sso=failed');

    const replay = await callback(STUB_CODE, state);
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe('/login?sso=failed');
    expect(cookieHeader(replay)).not.toContain('__Host-gg_session');
  });

  it('rejects an unknown code (AC-SSO-04)', async () => {
    const state = await startSso();
    const res = await callback('not-the-stub-code', state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=failed');
  });

  it('rejects an unverified email — no user is created (AC-SSO-05)', async () => {
    const state = await startSso();
    const res = await callback(STUB_UNVERIFIED_CODE, state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=failed');
    expect(cookieHeader(res)).not.toContain('__Host-gg_session');
    const users = app.get<UserRepository>(TOKENS.Users);
    expect(await users.findByEmail(STUB_UNVERIFIED_EMAIL)).toBeNull();
  });

  it('answers 404 Problem for an unknown provider on both routes (AC-SSO-06)', async () => {
    const start = await request(app.getHttpServer()).get('/auth/sso/okta/start');
    expect(start.status).toBe(404);
    expect(start.body.title).toBe('NOT_FOUND');

    const cb = await request(app.getHttpServer()).get('/auth/sso/okta/callback');
    expect(cb.status).toBe(404);
    expect(cb.body.title).toBe('NOT_FOUND');
  });
});

describe('SSO unconfigured (no Google env, no explicit offline opt-in) (AC-SSO-07)', () => {
  let bare: INestApplication;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Pin hermeticity: neither the harness's offline opt-in nor a dev machine's Google env may
    // leak into this composition (the provider factory reads process.env at module init).
    for (const key of ['SSO_MODE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URL']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    bare = moduleRef.createNestApplication();
    await bare.init();
  });

  afterAll(async () => {
    await bare.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('start degrades to 302 /login?sso=unavailable', async () => {
    const res = await request(bare.getHttpServer()).get('/auth/sso/google/start');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=unavailable');
    expect(cookieHeader(res)).not.toContain('__Host-gg_session');
  });

  it('callback degrades to 302 /login?sso=unavailable', async () => {
    const res = await request(bare.getHttpServer())
      .get('/auth/sso/google/callback')
      .query({ code: STUB_CODE, state: 'whatever' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso=unavailable');
  });

  it('still answers 404 Problem for an unknown provider', async () => {
    const res = await request(bare.getHttpServer()).get('/auth/sso/okta/start');
    expect(res.status).toBe(404);
    expect(res.body.title).toBe('NOT_FOUND');
  });
});
