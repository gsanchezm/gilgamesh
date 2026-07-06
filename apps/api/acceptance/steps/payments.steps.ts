import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

function invoices(world: GilgameshWorld): Record<string, unknown>[] {
  const body = world.response?.body;
  assert.ok(Array.isArray(body), 'expected an invoice array response');
  return body as Record<string, unknown>[];
}

/** The deterministic mock-provider webhook payload (spec 13 §3; the Stripe adapter maps real events). */
function webhookPayload(world: GilgameshWorld, type: string, providerInvoiceId: string, amountCents: number): string {
  return JSON.stringify({
    type,
    orgId: world.lastOrgId,
    providerInvoiceId,
    amountCents,
    currency: 'usd',
    hostedInvoiceUrl: `https://mock.pay/invoice/${providerInvoiceId}`,
  });
}

/** Webhooks are UNAUTHENTICATED (no cookie/CSRF — Stripe has neither); the signature is the auth. */
async function deliverWebhook(
  world: GilgameshWorld,
  provider: string,
  payload: string,
  signature: string | null,
): Promise<void> {
  let req = server(world).post(`${world.basePath}/billing/webhooks/${provider}`).set('Content-Type', 'application/json');
  if (signature !== null) req = req.set('stripe-signature', signature);
  world.response = await req.send(payload);
}

When('I GET the invoices', async function (this: GilgameshWorld) {
  this.response = await server(this)
    .get(this.url('/orgs/{orgId}/invoices'))
    .set('Cookie', this.cookie ?? '');
});

When('an unauthenticated client GETs the invoices', async function (this: GilgameshWorld) {
  this.response = await server(this).get(this.url('/orgs/{orgId}/invoices'));
});

When(
  'the provider delivers a signed {string} webhook for invoice {string} of {int} cents',
  async function (this: GilgameshWorld, type: string, providerInvoiceId: string, amountCents: number) {
    await deliverWebhook(this, 'stripe', webhookPayload(this, type, providerInvoiceId, amountCents), 'mock-signature');
  },
);

When(
  'the provider delivers an unsigned {string} webhook for invoice {string} of {int} cents',
  async function (this: GilgameshWorld, type: string, providerInvoiceId: string, amountCents: number) {
    await deliverWebhook(this, 'stripe', webhookPayload(this, type, providerInvoiceId, amountCents), null);
  },
);

When(
  'the provider delivers a signed {string} webhook to provider {string} for invoice {string} of {int} cents',
  async function (this: GilgameshWorld, type: string, provider: string, providerInvoiceId: string, amountCents: number) {
    await deliverWebhook(this, provider, webhookPayload(this, type, providerInvoiceId, amountCents), 'mock-signature');
  },
);

Then('the invoice list has {int} entries', function (this: GilgameshWorld, count: number) {
  assert.equal(invoices(this).length, count);
});

Then('invoice {int} has status {string}', function (this: GilgameshWorld, index: number, status: string) {
  assert.equal(invoices(this)[index - 1]?.status, status);
});

Then('invoice {int} has amount {int} cents', function (this: GilgameshWorld, index: number, amountCents: number) {
  assert.equal(invoices(this)[index - 1]?.amountCents, amountCents);
});

Then('invoice {int} has a hosted invoice url', function (this: GilgameshWorld, index: number) {
  assert.match(String(invoices(this)[index - 1]?.hostedInvoiceUrl ?? ''), /^https:\/\//);
});
