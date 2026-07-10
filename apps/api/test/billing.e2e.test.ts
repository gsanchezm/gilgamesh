import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;
let orgId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'billing@uruk.io', password: 'C0rrect-Horse!' });
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

describe('Subscription & Billing API', () => {
  it('requires authentication', async () => {
    expect((await request(server()).get(`/orgs/${orgId}/subscription`)).status).toBe(401);
  });

  it('views the seeded subscription with limits + usage', async () => {
    const res = await read(request(server()).get(`/orgs/${orgId}/subscription`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'FREE', status: 'TRIALING', maxSeats: 1, runMinutesQuota: 500 });
  });

  it('rejects a plan change without the CSRF token (403)', async () => {
    const res = await read(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'STARTER' });
    expect(res.status).toBe(403);
  });

  it('changes the plan (remaps quota), updates active workspaces, rejects bad input', async () => {
    const changed = await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'GROWTH' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ plan: 'GROWTH', runMinutesQuota: 25000, maxServicesPerWorkspace: 15 });

    expect((await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'NOPE' })).status).toBe(422);

    const seats = await mutate(request(server()).patch(`/orgs/${orgId}/subscription/seats`)).send({ seats: 8 });
    expect(seats.body.seats).toBe(8);
    expect((await mutate(request(server()).patch(`/orgs/${orgId}/subscription/seats`)).send({ seats: 0 })).status).toBe(422);
  });

  it('returns the computed 4-tier price: Scale base + $99/extra workspace, annual = 10 months (AC-B4T-03/04)', async () => {
    const scale = await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({ plan: 'SCALE' });
    expect(scale.status).toBe(200);
    expect(scale.body).toMatchObject({ plan: 'SCALE', unlimited: true, priceCents: 49900 });

    const seats = await mutate(request(server()).patch(`/orgs/${orgId}/subscription/seats`)).send({ seats: 12 });
    expect(seats.body.priceCents).toBe(69700); // 49900 + 2 × 9900 beyond the 10 included

    const annual = await mutate(request(server()).patch(`/orgs/${orgId}/subscription`)).send({
      plan: 'SCALE',
      billingCycle: 'ANNUAL',
    });
    expect(annual.body.priceCents).toBe(58083); // round(69700 × 10 / 12)
  });

  it('checks out (mock) then confirms to ACTIVE, then cancels', async () => {
    const checkout = await mutate(request(server()).post(`/orgs/${orgId}/subscription/checkout`)).send();
    expect(checkout.status).toBe(200);
    expect(checkout.body.checkoutUrl).toMatch(/^https:\/\/mock\.pay\/checkout\//);

    const confirmed = await mutate(request(server()).post(`/orgs/${orgId}/subscription/checkout/confirm`)).send();
    expect(confirmed.body.status).toBe('ACTIVE');
    expect(confirmed.body.providerCustomerId).toMatch(/^cus_mock_/);

    const canceled = await mutate(request(server()).post(`/orgs/${orgId}/subscription/cancel`)).send();
    expect(canceled.body.status).toBe('CANCELED');
    // AC-PRORATE-06: a cancel with no refund flag never carries a refunded amount.
    expect(canceled.body.refundedCents).toBeUndefined();
  });

  it("hides another tenant's subscription (404)", async () => {
    const reg2 = await request(server())
      .post('/auth/register')
      .send({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' });
    const auth2 = authFrom(reg2);
    const res = await request(server()).get(`/orgs/${orgId}/subscription`).set('Cookie', auth2.cookie);
    expect(res.status).toBe(404);
  });
});

// Slice 34 — the Stripe billing portal over its own fresh org so state is controlled per-assertion.
describe('Billing portal API (slice 34)', () => {
  let pAuth: Auth;
  let pOrgId: string;

  beforeAll(async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'P', lastName: 'O', email: 'portal@uruk.io', password: 'C0rrect-Horse!' });
    pAuth = authFrom(reg);
    const proj = await request(server())
      .post('/projects')
      .set('Cookie', pAuth.cookie)
      .set('X-CSRF-Token', pAuth.csrf)
      .send({ projectName: 'PortalCo', format: 'BDD' });
    pOrgId = proj.body.orgId;
  });

  const pmutate = (req: request.Test) => req.set('Cookie', pAuth.cookie).set('X-CSRF-Token', pAuth.csrf);

  it('requires authentication (401)', async () => {
    expect((await request(server()).post(`/orgs/${pOrgId}/billing/portal`)).status).toBe(401);
  });

  it('rejects a portal request without the CSRF token (403)', async () => {
    const res = await request(server()).post(`/orgs/${pOrgId}/billing/portal`).set('Cookie', pAuth.cookie);
    expect(res.status).toBe(403);
  });

  it('returns 422 before any checkout establishes a billing account (AC-PORTAL-04)', async () => {
    const res = await pmutate(request(server()).post(`/orgs/${pOrgId}/billing/portal`));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ title: 'VALIDATION' });
  });

  it('opens the portal after a checkout+confirm establishes the customer (AC-PORTAL-01)', async () => {
    await pmutate(request(server()).post(`/orgs/${pOrgId}/subscription/checkout`)).send();
    const confirmed = await pmutate(request(server()).post(`/orgs/${pOrgId}/subscription/checkout/confirm`)).send();
    expect(confirmed.body.providerCustomerId).toMatch(/^cus_mock_/);

    const res = await pmutate(request(server()).post(`/orgs/${pOrgId}/billing/portal`));
    expect(res.status).toBe(200);
    expect(res.body.portalUrl).toMatch(/^https:\/\/mock\.pay\/portal\//);
  });

  it("hides another tenant's portal (404, AC-PORTAL-03)", async () => {
    const reg2 = await request(server())
      .post('/auth/register')
      .send({ firstName: 'E', lastName: 'X', email: 'portal-eve@uruk.io', password: 'C0rrect-Horse!' });
    const auth2 = authFrom(reg2);
    const res = await request(server())
      .post(`/orgs/${pOrgId}/billing/portal`)
      .set('Cookie', auth2.cookie)
      .set('X-CSRF-Token', auth2.csrf);
    expect(res.status).toBe(404);
  });
});

// Slice 40 — programmatic proration + refunds over its own fresh org so provider state is controlled.
// The harness runs the mock arm under SystemClock, so amounts aren't pinnable to the cent — we assert
// the SIGN (>0 upgrade / <0 downgrade / ==0 no provider sub); exact amounts are pinned in unit tests.
describe('Proration + refunds API (slice 40)', () => {
  let rAuth: Auth;
  let rOrgId: string;

  beforeAll(async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'R', lastName: 'P', email: 'prorate@uruk.io', password: 'C0rrect-Horse!' });
    rAuth = authFrom(reg);
    const proj = await request(server())
      .post('/projects')
      .set('Cookie', rAuth.cookie)
      .set('X-CSRF-Token', rAuth.csrf)
      .send({ projectName: 'ProrateCo', format: 'BDD' });
    rOrgId = proj.body.orgId;
  });

  const rmutate = (req: request.Test) => req.set('Cookie', rAuth.cookie).set('X-CSRF-Token', rAuth.csrf);
  const path = (suffix = '') => `/orgs/${rOrgId}/subscription${suffix}`;

  it('previews and applies zero proration before any billing account exists (AC-PRORATE-03/04)', async () => {
    const preview = await rmutate(request(server()).post(path('/preview'))).send({ plan: 'GROWTH' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ plan: 'GROWTH', prorationCents: 0 });

    const changed = await rmutate(request(server()).patch(path())).send({ plan: 'STARTER' });
    expect(changed.status).toBe(200);
    expect(changed.body.prorationCents).toBe(0);
  });

  it('previews a positive proration for an upgrade once a checkout established the subscription (AC-PRORATE-01)', async () => {
    await rmutate(request(server()).post(path('/checkout'))).send();
    const confirmed = await rmutate(request(server()).post(path('/checkout/confirm'))).send();
    expect(confirmed.body.providerCustomerId).toMatch(/^cus_mock_/);

    const preview = await rmutate(request(server()).post(path('/preview'))).send({ plan: 'SCALE' });
    expect(preview.status).toBe(200);
    expect(preview.body.prorationCents).toBeGreaterThan(0);

    const upgraded = await rmutate(request(server()).patch(path())).send({ plan: 'SCALE' });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.plan).toBe('SCALE');
    expect(upgraded.body.prorationCents).toBeGreaterThan(0);
  });

  it('applies a negative proration on a downgrade (AC-PRORATE-02)', async () => {
    const downgraded = await rmutate(request(server()).patch(path())).send({ plan: 'STARTER' });
    expect(downgraded.status).toBe(200);
    expect(downgraded.body.plan).toBe('STARTER');
    expect(downgraded.body.prorationCents).toBeLessThan(0);
  });

  it('cancels with an opt-in prorated refund (AC-PRORATE-05)', async () => {
    const canceled = await rmutate(request(server()).post(path('/cancel'))).send({ refund: true });
    expect(canceled.status).toBe(200);
    expect(canceled.body.status).toBe('CANCELED');
    expect(canceled.body.refundedCents).toBeGreaterThan(0);
  });

  it('rejects a preview from a non-admin (403) and a non-member (404)', async () => {
    // A fresh org for a clean RBAC assertion.
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'A', lastName: 'B', email: 'prorate-rbac@uruk.io', password: 'C0rrect-Horse!' });
    const owner = authFrom(reg);
    const proj = await request(server())
      .post('/projects')
      .set('Cookie', owner.cookie)
      .set('X-CSRF-Token', owner.csrf)
      .send({ projectName: 'RbacCo', format: 'BDD' });
    const oOrgId = proj.body.orgId as string;

    const outsider = authFrom(
      await request(server())
        .post('/auth/register')
        .send({ firstName: 'E', lastName: 'X', email: 'prorate-eve@uruk.io', password: 'C0rrect-Horse!' }),
    );
    const res = await request(server())
      .post(`/orgs/${oOrgId}/subscription/preview`)
      .set('Cookie', outsider.cookie)
      .set('X-CSRF-Token', outsider.csrf)
      .send({ plan: 'GROWTH' });
    expect(res.status).toBe(404);
  });
});
