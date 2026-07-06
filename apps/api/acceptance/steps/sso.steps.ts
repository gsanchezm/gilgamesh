import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

// Deterministic stub vocabulary (application StubIdentityProvider; SSO_MODE=offline in cucumber.cjs).
const STUB_CODE = 'stub-sso-ok';
const STUB_UNVERIFIED_CODE = 'stub-sso-unverified';

async function getSso(world: GilgameshWorld, path: string) {
  const res = await request(world.app.getHttpServer()).get(world.url(path));
  world.response = res;
  world.captureCookie(res);
  return res;
}

async function callback(world: GilgameshWorld, code: string, state: string) {
  const qs = new URLSearchParams({ code, state }).toString();
  return getSso(world, `/auth/sso/google/callback?${qs}`);
}

// ---- Givens / Whens -------------------------------------------------------------------

Given('I started an SSO login and hold its state', async function (this: GilgameshWorld) {
  const res = await getSso(this, '/auth/sso/google/start');
  assert.equal(res.status, 302, 'expected /start to redirect to the IdP');
  const location = res.headers.location ?? '';
  const state = new URL(location).searchParams.get('state');
  assert.ok(state, `no state parameter in the authorize URL: ${location}`);
  this.notes.set('ssoState', state);
});

When(
  'I GET the SSO callback with the stub code and the held state',
  async function (this: GilgameshWorld) {
    const state = this.notes.get('ssoState') as string;
    assert.ok(state, 'no held SSO state — did the start step run?');
    await callback(this, STUB_CODE, state);
  },
);

When(
  'I GET the SSO callback with the stub code and state {string}',
  async function (this: GilgameshWorld, state: string) {
    await callback(this, STUB_CODE, state);
  },
);

When(
  'I GET the SSO callback with the unverified stub code and the held state',
  async function (this: GilgameshWorld) {
    const state = this.notes.get('ssoState') as string;
    assert.ok(state, 'no held SSO state — did the start step run?');
    await callback(this, STUB_UNVERIFIED_CODE, state);
  },
);

// ---- Thens ----------------------------------------------------------------------------

Then('the redirect Location is {string}', function (this: GilgameshWorld, expected: string) {
  assert.equal(this.response?.headers.location, expected);
});

Then(
  'the redirect Location carries {string} and {string} parameters',
  function (this: GilgameshWorld, a: string, b: string) {
    const location = this.response?.headers.location ?? '';
    const params = new URL(location).searchParams;
    assert.ok(params.get(a), `authorize URL is missing "${a}": ${location}`);
    assert.ok(params.get(b), `authorize URL is missing "${b}": ${location}`);
  },
);

Then('no User row exists for email {string}', async function (this: GilgameshWorld, email: string) {
  assert.equal(await this.db.user.count({ where: { email } }), 0, `a User was created for ${email}`);
});

Then(
  'the stored passwordHash for {string} is an Argon2id hash',
  async function (this: GilgameshWorld, email: string) {
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User persisted for ${email}`);
    assert.ok(user.passwordHash.startsWith('$argon2'), 'passwordHash is not an Argon2 hash');
  },
);

Then('no AuditLog metadata contains the SSO code or state', async function (this: GilgameshWorld) {
  const rows = await this.db.auditLog.findMany();
  const serialized = JSON.stringify(rows.map((r) => r.metadata));
  const state = this.notes.get('ssoState') as string | undefined;
  assert.ok(!serialized.includes(STUB_CODE), 'the SSO code leaked into audit metadata');
  assert.ok(!state || !serialized.includes(state), 'the SSO state leaked into audit metadata');
});
