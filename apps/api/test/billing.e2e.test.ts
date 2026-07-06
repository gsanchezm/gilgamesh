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
