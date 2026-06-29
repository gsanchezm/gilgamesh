import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

// ---- Background / shared vocabulary -------------------------------------------------

Given('the API base path is {string}', function (this: GilgameshWorld, basePath: string) {
  this.basePath = basePath;
});

Given('authentication uses an httpOnly session cookie', function () {
  // Documentary: cookie hardening is asserted by the dedicated security scenarios.
});

// ---- HTTP verbs ---------------------------------------------------------------------

/** Build a request body from a one-row DataTable, normalizing spec column names to DTO fields. */
function bodyFromTable(table: DataTable): Record<string, unknown> {
  const raw = table.hashes()[0] ?? {};
  const body: Record<string, unknown> = { ...raw };
  // The login feature uses the column "remember"; the LoginRequest DTO field is "rememberMe" (boolean).
  if ('remember' in body) {
    body.rememberMe = body.remember === 'true';
    delete body.remember;
  }
  return body;
}

// `When I POST "/auth/register" with a "UserCreate" body:` followed by a one-row table.
When(
  'I POST {string} with a {string} body:',
  async function (this: GilgameshWorld, path: string, _schema: string, table: DataTable) {
    const body = bodyFromTable(table);
    if (typeof body.password === 'string') this.notes.set('lastPassword', body.password);
    const req = request(this.app.getHttpServer()).post(this.url(path));
    if (this.cookie) req.set('Cookie', this.cookie);
    this.response = await req.send(body);
    this.captureCookie(this.response);
  },
);

When('I GET {string}', async function (this: GilgameshWorld, path: string) {
  const req = request(this.app.getHttpServer()).get(this.url(path));
  if (this.cookie) req.set('Cookie', this.cookie);
  this.response = await req.send();
});

// ---- Response assertions ------------------------------------------------------------

Then('the response status is {int}', function (this: GilgameshWorld, status: number) {
  assert.ok(this.response, 'no response captured');
  assert.equal(this.response.status, status);
});

function setCookieList(world: GilgameshWorld): string[] {
  const raw = world.response?.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

Then('the response sets a session cookie', function (this: GilgameshWorld) {
  assert.ok(
    setCookieList(this).some((c) => c.startsWith('__Host-gg_session')),
    'expected a __Host-gg_session Set-Cookie header',
  );
});

Then('the response sets an httpOnly session cookie', function (this: GilgameshWorld) {
  const session = setCookieList(this).find((c) => c.startsWith('__Host-gg_session'));
  assert.ok(session, 'expected a __Host-gg_session Set-Cookie header');
  assert.match(session, /HttpOnly/i, 'session cookie is not HttpOnly');
});

Then('no session cookie is set', function (this: GilgameshWorld) {
  assert.ok(
    !setCookieList(this).some((c) => c.startsWith('__Host-gg_session')),
    'expected no session cookie to be set',
  );
});

// RFC9457 problem document, served as application/problem+json by DomainExceptionFilter.
Then('the response body is a {string} document', function (this: GilgameshWorld, kind: string) {
  assert.equal(kind, 'Problem');
  const body = this.response?.body as Record<string, unknown> | undefined;
  assert.ok(body && typeof body === 'object', 'no response body');
  assert.ok('title' in body && 'status' in body, 'not a Problem document (missing title/status)');
});

Then('an AuditLog entry {string} is recorded', async function (this: GilgameshWorld, action: string) {
  const count = await this.db.auditLog.count({ where: { action } });
  assert.ok(count >= 1, `expected an AuditLog "${action}" entry`);
});
