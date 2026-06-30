import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

let app: INestApplication;
let auth: Auth;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // app.init() runs onApplicationBootstrap -> KnowledgeSeeder seeds the sample KB.
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'knowledge@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);
});

afterAll(async () => {
  await app.close();
});

const read = (req: request.Test) => req.set('Cookie', auth.cookie);
const server = () => app.getHttpServer();

describe('Knowledge / RAG API', () => {
  it('requires authentication', async () => {
    expect((await request(server()).get('/knowledge/search').query({ q: 'example' })).status).toBe(401);
  });

  it('searches the seeded shared KB and returns lexically-relevant results with citations', async () => {
    const res = await read(request(server()).get('/knowledge/search').query({ q: 'example mapping discovery cards', k: 3 }));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].citation).toMatchObject({ source: 'bddbooks-discovery' });
    expect(res.body.results[0].score).toBeGreaterThan(0);
    expect(res.body.results[0].content).toContain('Example mapping');
  });

  it('ranks a different query toward a different source (boundary value -> CTFL)', async () => {
    const res = await read(request(server()).get('/knowledge/search').query({ q: 'boundary value analysis partitions' }));
    expect(res.status).toBe(200);
    expect(res.body.results[0].citation.source).toContain('CTFL');
  });

  it('rejects an empty query (422)', async () => {
    expect((await read(request(server()).get('/knowledge/search').query({ q: '' }))).status).toBe(422);
  });
});
