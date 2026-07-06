import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import request from 'supertest';
import { TOKENS } from '../../src/persistence/tokens';
import type { GilgameshWorld } from '../support/world';

// Slice 12 — auth recovery (spec.md §8; supersedes the slice-1 @wip drafts).
// The recorded-mail seam is the StubEmail bound to TOKENS.Email (owner decision S12): tests read
// the raw token from the recorded mail — the DB only ever holds its sha256 hash.

interface RecordedMail {
  to: string;
  subject: string;
  text: string;
}

function mailbox(world: GilgameshWorld): RecordedMail[] {
  return (world.app.get(TOKENS.Email) as { sent: RecordedMail[] }).sent;
}

/** Mails sent to `to` during the current scenario (the singleton mailbox spans scenarios). */
function mailsTo(world: GilgameshWorld, to: string): RecordedMail[] {
  const start = Number(world.notes.get('mailCountBefore') ?? 0);
  return mailbox(world)
    .slice(start)
    .filter((m) => m.to === to);
}

function tokenOf(mail: RecordedMail): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail.text);
  assert.ok(match, `no reset token link in the recorded mail: ${mail.text}`);
  return match![1]!;
}

async function postForgot(world: GilgameshWorld, email: string) {
  const res = await request(world.app.getHttpServer())
    .post(world.url('/auth/forgot-password'))
    .send({ email });
  world.response = res;
  return res;
}

// The mailbox is only resolvable once TOKENS.Email is provided; before that (or on a 404 harness)
// treat it as empty so the failing assertion is the endpoint status, not a DI error.
function mailboxLength(world: GilgameshWorld): number {
  try {
    return mailbox(world).length;
  } catch {
    return 0;
  }
}

async function postReset(world: GilgameshWorld, token: string, newPassword: string) {
  const res = await request(world.app.getHttpServer())
    .post(world.url('/auth/reset-password'))
    .send({ token, newPassword });
  world.response = res;
  return res;
}

// ---- Whens ---------------------------------------------------------------------------

When('I POST {string} for email {string}', async function (this: GilgameshWorld, _path: string, email: string) {
  this.notes.set('mailCountBefore', mailboxLength(this));
  await postForgot(this, email);
});

When(
  'I POST {string} with the noted token {string} and newPassword {string}',
  async function (this: GilgameshWorld, _path: string, name: string, newPassword: string) {
    const token = this.notes.get(name);
    assert.ok(typeof token === 'string' && token, `no reset token noted as "${name}"`);
    await postReset(this, token as string, newPassword);
  },
);

When(
  'I POST {string} with token {string} and newPassword {string}',
  async function (this: GilgameshWorld, _path: string, token: string, newPassword: string) {
    await postReset(this, token, newPassword);
  },
);

// ---- Givens --------------------------------------------------------------------------

Given('the User {string} has two active Sessions', async function (this: GilgameshWorld, email: string) {
  // Register (the "a User exists..." Given) opened session #1; a login opens session #2.
  const res = await request(this.app.getHttpServer())
    .post(this.url('/auth/login'))
    .send({ email, password: this.notes.get('password') });
  assert.equal(res.status, 200, 'login for the second session failed');
  this.captureCookie(res); // the "old cookie" the reset must kill
  const user = await this.db.user.findFirst({ where: { email } });
  assert.ok(user, `no User for ${email}`);
  const active = await this.db.session.count({ where: { userId: user.id, revokedAt: null } });
  assert.ok(active >= 2, `expected two active sessions, found ${active}`);
});

Given(
  'I hold a recorded reset token for {string} noted as {string}',
  async function (this: GilgameshWorld, email: string, name: string) {
    this.notes.set('mailCountBefore', mailboxLength(this));
    const res = await postForgot(this, email);
    assert.equal(res.status, 202, 'forgot-password did not accept the request');
    const mails = mailsTo(this, email);
    assert.ok(mails.length >= 1, `no reset mail recorded for ${email}`);
    this.notes.set(name, tokenOf(mails[mails.length - 1]!));
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    this.notes.set('passwordHashBefore', user.passwordHash);
  },
);

Given(
  'an expired PasswordReset row exists for {string} with raw token {string}',
  async function (this: GilgameshWorld, email: string, rawToken: string) {
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    await this.db.passwordReset.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() - 60_000), // already expired
        usedAt: null,
        createdAt: new Date(Date.now() - 31 * 60_000),
      },
    });
  },
);

// ---- Thens: forgot-password ----------------------------------------------------------

Then(
  'a PasswordReset row exists for {string} with a future expiry within 30 minutes and no usedAt',
  async function (this: GilgameshWorld, email: string) {
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    const row = await this.db.passwordReset.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(row, `no PasswordReset row for ${email}`);
    const ttlMs = row.expiresAt.getTime() - Date.now();
    assert.ok(ttlMs > 0, 'the reset token is already expired');
    assert.ok(ttlMs <= 30 * 60_000, `TTL exceeds 30 minutes (${ttlMs} ms)`);
    assert.equal(row.usedAt, null, 'a fresh token must not be consumed');
  },
);

Then('a reset mail is recorded via the EmailPort for {string}', function (this: GilgameshWorld, email: string) {
  assert.ok(mailsTo(this, email).length >= 1, `no reset mail recorded for ${email}`);
});

Then(
  'the recorded reset mail carries a raw token whose sha256 hash matches the stored {string}',
  async function (this: GilgameshWorld, field: string) {
    assert.equal(field, 'tokenHash');
    const mails = mailsTo(this, 'ishtar@uruk.io');
    assert.ok(mails.length >= 1, 'no reset mail recorded');
    const raw = tokenOf(mails[mails.length - 1]!);
    this.notes.set('lastResetToken', raw);
    const row = await this.db.passwordReset.findFirst({ orderBy: { createdAt: 'desc' } });
    assert.ok(row, 'no PasswordReset row persisted');
    assert.equal(row.tokenHash, createHash('sha256').update(raw).digest('hex'));
  },
);

Then('the raw reset token is not persisted in the PasswordReset row', async function (this: GilgameshWorld) {
  const raw = this.notes.get('lastResetToken') as string;
  assert.ok(raw, 'no raw token captured');
  const rows = await this.db.passwordReset.findMany();
  for (const row of rows) {
    assert.notEqual(row.tokenHash, raw, 'the raw token was stored instead of its hash');
  }
});

Then('no AuditLog metadata contains the raw reset token', async function (this: GilgameshWorld) {
  const raw = this.notes.get('lastResetToken') as string;
  assert.ok(raw, 'no raw token captured');
  const rows = await this.db.auditLog.findMany();
  const serialized = JSON.stringify(rows.map((r) => r.metadata));
  assert.ok(!serialized.includes(raw), 'the raw reset token leaked into audit metadata');
});

Then('no PasswordReset row exists', async function (this: GilgameshWorld) {
  assert.equal(await this.db.passwordReset.count(), 0, 'an unexpected PasswordReset row was created');
});

Then('no reset mail is recorded', function (this: GilgameshWorld) {
  const start = Number(this.notes.get('mailCountBefore') ?? 0);
  const since = mailbox(this).slice(start);
  assert.equal(since.length, 0, `unexpected mail recorded: ${JSON.stringify(since)}`);
});

// ---- Thens: reset-password -----------------------------------------------------------

Then(
  'the stored {string} for {string} is a new Argon2id hash',
  async function (this: GilgameshWorld, field: string, email: string) {
    assert.equal(field, 'passwordHash');
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    assert.ok(user.passwordHash.startsWith('$argon2'), 'passwordHash is not an Argon2 hash');
    assert.notEqual(user.passwordHash, this.notes.get('passwordHashBefore'), 'passwordHash did not change');
  },
);

Then('all Sessions of {string} are revoked', async function (this: GilgameshWorld, email: string) {
  const user = await this.db.user.findFirst({ where: { email } });
  assert.ok(user, `no User for ${email}`);
  const sessions = await this.db.session.findMany({ where: { userId: user.id } });
  assert.ok(sessions.length >= 2, 'expected the pre-reset sessions to exist');
  for (const s of sessions) {
    assert.notEqual(s.revokedAt, null, `session ${s.id} was not revoked`);
  }
});

Then(
  'the PasswordReset row for {string} has {string} set',
  async function (this: GilgameshWorld, email: string, field: string) {
    assert.equal(field, 'usedAt');
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    const row = await this.db.passwordReset.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(row, `no PasswordReset row for ${email}`);
    assert.notEqual(row.usedAt, null, 'the token was not consumed');
  },
);

Then(
  'the PasswordReset row for {string} has no {string}',
  async function (this: GilgameshWorld, email: string, field: string) {
    assert.equal(field, 'usedAt');
    const user = await this.db.user.findFirst({ where: { email } });
    assert.ok(user, `no User for ${email}`);
    const row = await this.db.passwordReset.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(row, `no PasswordReset row for ${email}`);
    assert.equal(row.usedAt, null, 'the token must not be consumed by a rejected reset');
  },
);

Then(
  'signing in as {string} with password {string} returns {int}',
  async function (this: GilgameshWorld, email: string, password: string, status: number) {
    // Deliberately does NOT capture cookies: the world keeps the pre-reset "old cookie".
    const res = await request(this.app.getHttpServer())
      .post(this.url('/auth/login'))
      .send({ email, password });
    assert.equal(res.status, status, `sign-in as ${email} returned ${res.status}, expected ${status}`);
  },
);
