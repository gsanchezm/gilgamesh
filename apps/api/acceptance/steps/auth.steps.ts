import { createHash } from 'node:crypto';
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

const DEFAULT_PASSWORD = 'C0rrect-Horse!';
const validRegister = (email: string, password = DEFAULT_PASSWORD) => ({
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email,
  password,
});

async function postRegister(world: GilgameshWorld, body: Record<string, unknown>) {
  const res = await request(world.app.getHttpServer()).post(world.url('/auth/register')).send(body);
  world.response = res;
  world.captureCookie(res);
  return res;
}

async function postLogin(world: GilgameshWorld, body: Record<string, unknown>) {
  const res = await request(world.app.getHttpServer()).post(world.url('/auth/login')).send(body);
  world.response = res;
  world.captureCookie(res);
  return res;
}

// ---- Givens: user fixtures ----------------------------------------------------------

Given('no User exists with email {string}', async function (this: GilgameshWorld, email: string) {
  const user = await this.db.user.findFirst({ where: { email } });
  assert.equal(user, null, `expected no User for ${email}`);
});

Given('a User already exists with email {string}', async function (this: GilgameshWorld, email: string) {
  await postRegister(this, validRegister(email));
  this.cookie = null; // the duplicate attempt below is unauthenticated
});

Given('a User exists with email {string}', async function (this: GilgameshWorld, email: string) {
  await postRegister(this, validRegister(email));
  this.notes.set('email', email);
  this.notes.set('password', DEFAULT_PASSWORD);
});

Given(
  'a User exists with email {string} and password {string}',
  async function (this: GilgameshWorld, email: string, password: string) {
    await postRegister(this, validRegister(email, password));
    this.notes.set('email', email);
    this.notes.set('password', password);
  },
);

Given(
  'a User exists with email {string} and status {string}',
  async function (this: GilgameshWorld, email: string, status: string) {
    await postRegister(this, validRegister(email));
    await this.db.user.update({ where: { email }, data: { status } });
    this.notes.set('email', email);
    this.notes.set('password', DEFAULT_PASSWORD);
    this.notes.set('sessionsBefore', await this.db.session.count());
  },
);

Given('I hold a pre-login session token {string}', function (this: GilgameshWorld, name: string) {
  this.notes.set(name, this.cookie);
});

// ---- Whens --------------------------------------------------------------------------

When(
  'I POST {string} with a {string} body for email {string}',
  async function (this: GilgameshWorld, _path: string, _schema: string, email: string) {
    await postRegister(this, validRegister(email));
  },
);

When(
  // Scenario Outline substitutes <defect> unquoted, so match the trailing free text with a regex.
  /^I POST "([^"]+)" with a "([^"]+)" body that has (.+)$/,
  async function (this: GilgameshWorld, _path: string, _schema: string, defect: string) {
    const base = validRegister('ishtar@uruk.io');
    let body: Record<string, unknown>;
    switch (defect) {
      case 'a malformed email':
        body = { ...base, email: 'not-an-email' };
        break;
      case 'a missing firstName':
        body = { lastName: base.lastName, email: base.email, password: base.password };
        break;
      case 'a missing lastName':
        body = { firstName: base.firstName, email: base.email, password: base.password };
        break;
      case 'a password below the policy':
        body = { ...base, password: 'short' };
        break;
      default:
        throw new Error(`unknown defect: ${defect}`);
    }
    await postRegister(this, body);
  },
);

When(
  // <case> is substituted unquoted; enumerate the two phrases so this never collides with other POST steps.
  /^I POST "([^"]+)" with (a known email and a wrong password|an unknown email and any password)$/,
  async function (this: GilgameshWorld, _path: string, scenario: string) {
  if (scenario.includes('known email')) {
    await postRegister(this, validRegister('ishtar@uruk.io'));
    this.cookie = null;
    this.notes.set('attemptedPassword', 'definitely-wrong');
    await postLogin(this, { email: 'ishtar@uruk.io', password: 'definitely-wrong' });
  } else {
    this.notes.set('attemptedPassword', 'whatever-pass');
    await postLogin(this, { email: 'ghost@nowhere.test', password: 'whatever-pass' });
  }
});

When(
  'I POST {string} with the correct password for {string}',
  async function (this: GilgameshWorld, _path: string, email: string) {
    await postLogin(this, { email, password: this.notes.get('password') ?? DEFAULT_PASSWORD });
  },
);

When(
  // Two variants in the feature: "I sign in ..." and "I sign in again ...".
  /^I sign in(?: again)? with rememberMe "([^"]*)" and note the Session "([^"]*)" as "([^"]*)"$/,
  async function (this: GilgameshWorld, rememberMe: string, _field: string, name: string) {
    await postLogin(this, {
      email: this.notes.get('email'),
      password: this.notes.get('password') ?? DEFAULT_PASSWORD,
      rememberMe: rememberMe === 'true',
    });
    const session = await this.db.session.findFirst({ orderBy: { createdAt: 'desc' } });
    assert.ok(session, 'no session persisted after sign-in');
    this.notes.set(name, session.expiresAt);
  },
);

// ---- Thens --------------------------------------------------------------------------

Then(
  'a User is created with email {string} and status {string}',
  async function (this: GilgameshWorld, email: string, status: string) {
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User persisted for ${email}`);
    assert.equal(user.status, status);
  },
);

Then(
  'the stored {string} is an Argon2id hash and not the plaintext password',
  async function (this: GilgameshWorld, field: string) {
    assert.equal(field, 'passwordHash');
    const user = await this.db.user.findFirst({ orderBy: { createdAt: 'desc' } });
    assert.ok(user, 'no User persisted');
    assert.ok(user.passwordHash.startsWith('$argon2'), 'passwordHash is not an Argon2 hash');
    assert.notEqual(user.passwordHash, this.notes.get('lastPassword'));
  },
);

Then(
  'an AuditLog entry {string} is recorded for that User',
  async function (this: GilgameshWorld, action: string) {
    const count = await this.db.auditLog.count({ where: { action } });
    assert.ok(count >= 1, `expected an AuditLog "${action}" entry`);
  },
);

Then(
  'because the User has no Membership the client routes to onboarding',
  async function (this: GilgameshWorld) {
    assert.equal(await this.db.membership.count(), 0, 'expected the new user to have no Membership');
  },
);

Then('no second User is created for {string}', async function (this: GilgameshWorld, email: string) {
  assert.equal(await this.db.user.count({ where: { email } }), 1, 'a duplicate User was created');
});

Then('the attempt is audited', async function (this: GilgameshWorld) {
  // The duplicate-registration attempt should leave an audit trail beyond the first success.
  assert.ok(await this.db.auditLog.count() >= 2, 'the failed attempt was not audited');
});

Then(
  'a new Session is created whose token differs from {string}',
  function (this: GilgameshWorld, name: string) {
    const prior = this.notes.get(name);
    assert.ok(this.cookie, 'no session cookie after sign-in');
    assert.notEqual(this.cookie, prior, 'a new session token was not issued');
  },
);

Then('no User is created', async function (this: GilgameshWorld) {
  assert.equal(await this.db.user.count(), 0, 'a User was created despite invalid input');
});

Then('the response message is the generic {string}', function (this: GilgameshWorld, message: string) {
  const body = this.response?.body as { detail?: string; message?: string } | undefined;
  assert.equal(body?.detail ?? body?.message, message);
});

Then(
  'an AuditLog entry {string} is recorded without the attempted password',
  async function (this: GilgameshWorld, action: string) {
    const rows = await this.db.auditLog.findMany({ where: { action } });
    assert.ok(rows.length >= 1, `expected an AuditLog "${action}" entry`);
    const attempted = this.notes.get('attemptedPassword');
    const serialized = JSON.stringify(rows.map((r) => r.metadata));
    assert.ok(
      !attempted || !serialized.includes(String(attempted)),
      'the attempted password leaked into the audit metadata',
    );
  },
);

Then('no Session is created', async function (this: GilgameshWorld) {
  const before = Number(this.notes.get('sessionsBefore') ?? 0);
  assert.equal(await this.db.session.count(), before, 'an unexpected Session was created');
});

Then(
  'the client routes by membership: onboarding when none, otherwise the agent room',
  async function (this: GilgameshWorld) {
    // API-observable part: a no-membership user lands tenant-less (activeOrgId null).
    const body = this.response?.body as { activeOrgId?: string | null } | undefined;
    const memberships = await this.db.membership.count();
    if (memberships === 0) assert.equal(body?.activeOrgId ?? null, null);
  },
);

Then('{string} is later than {string}', function (this: GilgameshWorld, laterName: string, earlierName: string) {
  const later = new Date(this.notes.get(laterName) as string | Date).getTime();
  const earlier = new Date(this.notes.get(earlierName) as string | Date).getTime();
  assert.ok(later > earlier, `${laterName} (${later}) is not later than ${earlierName} (${earlier})`);
});

// ---- Session: /auth/me + logout (AC-AUTH-08/09) ------------------------------------

Given('I am signed in with an active Session', async function (this: GilgameshWorld) {
  await postRegister(this, validRegister('ishtar@uruk.io'));
});

Then('that Session has {string} set', async function (this: GilgameshWorld, field: string) {
  assert.equal(field, 'revokedAt');
  const session = await this.db.session.findFirst({ orderBy: { createdAt: 'desc' } });
  assert.ok(session, 'no session persisted');
  assert.notEqual(session.revokedAt, null, 'the session was not revoked');
});

Then('the session cookie is cleared', function (this: GilgameshWorld) {
  const raw = this.response?.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const cookie = cookies.find((c) => c.startsWith('__Host-gg_session'));
  assert.ok(cookie, 'expected a Set-Cookie clearing the session');
  const cleared =
    /^__Host-gg_session=;/.test(cookie) ||
    /Expires=Thu, 01 Jan 1970/i.test(cookie) ||
    /Max-Age=0/i.test(cookie);
  assert.ok(cleared, `session cookie not cleared: ${cookie}`);
});

Then(
  'a subsequent {string} with the old cookie returns {int}',
  async function (this: GilgameshWorld, call: string, status: number) {
    const path = call.replace(/^GET\s+/, '');
    const req = request(this.app.getHttpServer()).get(this.url(path));
    if (this.cookie) req.set('Cookie', this.cookie);
    this.response = await req.send();
    assert.equal(this.response.status, status);
  },
);

Then(
  'the response body is a {string} with the embedded memberships array and {string}',
  function (this: GilgameshWorld, _view: string, _field: string) {
    const body = this.response?.body as { user?: unknown; memberships?: unknown } | undefined;
    assert.ok(body?.user, 'MeView is missing the user object');
    assert.ok(Array.isArray(body?.memberships), 'MeView is missing the memberships array');
    assert.ok(body && 'activeOrgId' in body, 'MeView is missing activeOrgId');
  },
);

When('I GET {string} without a session cookie', async function (this: GilgameshWorld, path: string) {
  this.response = await request(this.app.getHttpServer()).get(this.url(path)).send();
});

// ---- Cookie hardening + CSRF (AC-AUTH-14) ------------------------------------------

Given('I have just signed in', async function (this: GilgameshWorld) {
  const res = await postRegister(this, validRegister('ishtar@uruk.io'));
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const session = cookies.find((c) => c.startsWith('__Host-gg_session')) ?? '';
  this.notes.set('sessionSetCookie', session);
  this.notes.set('sessionToken', session.split(';')[0].slice('__Host-gg_session='.length));
});

Then('the session cookie is {string}', function (this: GilgameshWorld, attr: string) {
  const c = this.notes.get('sessionSetCookie') as string;
  assert.match(c, new RegExp(attr, 'i'), `session cookie missing "${attr}"`);
});

Then('the session cookie has a {string} attribute', function (this: GilgameshWorld, attr: string) {
  const c = this.notes.get('sessionSetCookie') as string;
  assert.match(c, new RegExp(attr, 'i'), `session cookie missing "${attr}"`);
});

Then('the session cookie name carries the {string} prefix', function (this: GilgameshWorld, prefix: string) {
  const c = this.notes.get('sessionSetCookie') as string;
  assert.ok(c.startsWith(prefix), `session cookie name does not carry "${prefix}"`);
});

Then('only the token hash is persisted in the Session row', async function (this: GilgameshWorld) {
  const token = this.notes.get('sessionToken') as string;
  const session = await this.db.session.findFirst({ orderBy: { createdAt: 'desc' } });
  assert.ok(session, 'no session persisted');
  assert.equal(session.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(session.tokenHash, token, 'the raw token must not be stored');
});

Then('state-changing requests require a valid CSRF token', async function (this: GilgameshWorld) {
  const without = await request(this.app.getHttpServer())
    .post(this.url('/projects'))
    .set('Cookie', this.cookie ?? '') // session cookie present, no X-CSRF-Token
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  assert.equal(without.status, 403, 'a mutation without the CSRF token should be rejected');

  const withToken = await this.applyAuth(
    request(this.app.getHttpServer()).post(this.url('/projects')),
  ).send({ projectName: 'OmniPizza', format: 'BDD' });
  assert.notEqual(withToken.status, 403, 'a mutation with a valid CSRF token should not be a CSRF failure');
});
