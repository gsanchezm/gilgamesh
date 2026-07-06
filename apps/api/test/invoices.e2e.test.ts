import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureBodyParser } from '../src/common/body-parser';
import { type Auth, authFrom } from './support/auth';

/**
 * Slice 13 (AC-PAY-01..06): the invoices list + the provider webhook sink, fully offline against
 * the mock provider. Boots the same configureBodyParser wiring main.ts uses — the webhook route's
 * signature verification runs over the RAW body bytes that wiring preserves.
 */
let app: INestApplication;
let auth: Auth;
let orgId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureBodyParser(app as NestExpressApplication);
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'invoices@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);

  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  orgId = proj.body.orgId;
});

afterAll(async () => {
  await app.close();
});

const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
const read = (req: request.Test) => req.set('Cookie', auth.cookie);
const server = () => app.getHttpServer();

/** Webhooks carry NO cookie/CSRF — Stripe has neither; the signature is the auth. */
function webhook(payload: Record<string, unknown>, signature: string | null) {
  let req = request(server()).post('/billing/webhooks/stripe').set('Content-Type', 'application/json');
  if (signature !== null) req = req.set('stripe-signature', signature);
  return req.send(JSON.stringify(payload));
}

describe('Invoices + billing webhooks API (slice 13)', () => {
  it('requires authentication to list invoices', async () => {
    expect((await request(server()).get(`/orgs/${orgId}/invoices`)).status).toBe(401);
  });

  it('starts with an empty invoice list (AC-PAY-01)', async () => {
    const res = await read(request(server()).get(`/orgs/${orgId}/invoices`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('confirming the mock checkout records one PAID invoice at the computed price, idempotently (AC-PAY-02)', async () => {
    await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'GROWTH' });
    await mutate(request(server()).post(`/orgs/${orgId}/subscription/checkout`)).send();
    await mutate(request(server()).post(`/orgs/${orgId}/subscription/checkout/confirm`)).send();
    await mutate(request(server()).post(`/orgs/${orgId}/subscription/checkout/confirm`)).send();

    const res = await read(request(server()).get(`/orgs/${orgId}/invoices`));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      providerInvoiceId: `in_mock_${orgId}`,
      status: 'PAID',
      amountCents: 9900,
      currency: 'usd',
      hostedInvoiceUrl: `https://mock.pay/invoice/in_mock_${orgId}`,
    });
  });

  it('a signed webhook upserts the invoice through its lifecycle in ONE row (AC-PAY-03/04)', async () => {
    const base = { orgId, providerInvoiceId: 'in_e2e_1', amountCents: 4900, currency: 'usd' };
    const finalized = await webhook({ type: 'invoice.finalized', ...base }, 'mock-signature');
    expect(finalized.status).toBe(200);
    expect(finalized.body).toEqual({ received: true });

    const paid = await webhook({ type: 'invoice.paid', ...base }, 'mock-signature');
    expect(paid.status).toBe(200);

    const list = await read(request(server()).get(`/orgs/${orgId}/invoices`));
    const row = (list.body as { providerInvoiceId: string; status: string }[]).filter(
      (i) => i.providerInvoiceId === 'in_e2e_1',
    );
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ status: 'PAID', amountCents: 4900 });

    const sub = await read(request(server()).get(`/orgs/${orgId}/subscription`));
    expect(sub.body.status).toBe('ACTIVE');

    const failedPayment = await webhook({ type: 'invoice.payment_failed', ...base }, 'mock-signature');
    expect(failedPayment.status).toBe(200);
    expect((await read(request(server()).get(`/orgs/${orgId}/subscription`))).body.status).toBe('PAST_DUE');
  });

  it('rejects a missing/invalid signature with a 4xx Problem and persists nothing (AC-PAY-05)', async () => {
    const payload = { type: 'invoice.paid', orgId, providerInvoiceId: 'in_evil', amountCents: 1 };
    const unsigned = await webhook(payload, null);
    expect(unsigned.status).toBe(403);
    expect(unsigned.headers['content-type']).toContain('application/problem+json');

    const badSig = await webhook(payload, 'forged');
    expect(badSig.status).toBe(403);

    const list = await read(request(server()).get(`/orgs/${orgId}/invoices`));
    expect((list.body as { providerInvoiceId: string }[]).some((i) => i.providerInvoiceId === 'in_evil')).toBe(false);
  });

  it('malformed webhook payloads map to 422, oversized ones to 413 (raw branch keeps the body limit)', async () => {
    const malformed = await request(server())
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'mock-signature')
      .send('not-json{');
    expect(malformed.status).toBe(422);

    const oversized = await request(server())
      .post('/billing/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'mock-signature')
      .send(JSON.stringify({ type: 'invoice.paid', pad: 'x'.repeat(600 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('unknown providers are 404 (AC-PAY-06)', async () => {
    const res = await request(server())
      .post('/billing/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'mock-signature')
      .send(JSON.stringify({ type: 'invoice.paid' }));
    expect(res.status).toBe(404);
  });

  it("hides another tenant's invoices (404, never 403) (AC-PAY-06)", async () => {
    const reg2 = await request(server())
      .post('/auth/register')
      .send({ firstName: 'E', lastName: 'X', email: 'eve-invoices@uruk.io', password: 'C0rrect-Horse!' });
    const auth2 = authFrom(reg2);
    const res = await request(server()).get(`/orgs/${orgId}/invoices`).set('Cookie', auth2.cookie);
    expect(res.status).toBe(404);
  });
});
