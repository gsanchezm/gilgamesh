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

describe('Per-org knowledge documents API (slice 7)', () => {
  let member: Auth;
  let orgId: string;

  beforeAll(async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'K', lastName: 'Owner', email: 'kb-owner@uruk.io', password: 'C0rrect-Horse!' });
    member = authFrom(reg);
    // Onboarding bootstraps the org; /auth/me then reports its id.
    await request(server())
      .post('/projects')
      .set('Cookie', member.cookie)
      .set('X-CSRF-Token', member.csrf)
      .send({ projectName: 'KB Org', format: 'BDD' })
      .expect(201);
    const me = await request(server()).get('/auth/me').set('Cookie', member.cookie).expect(200);
    orgId = me.body.activeOrgId as string;
  });

  it('uploads a markdown document and lists it', async () => {
    const up = await request(server())
      .post(`/orgs/${orgId}/knowledge/documents`)
      .set('Cookie', member.cookie)
      .set('X-CSRF-Token', member.csrf)
      .send({ name: 'design.md', type: 'md', content: '# Test Design\n\nBoundary value analysis picks edges.' });
    expect(up.status).toBe(201);
    expect(up.body.chunkCount).toBeGreaterThan(0);

    const list = await request(server())
      .get(`/orgs/${orgId}/knowledge/documents`)
      .set('Cookie', member.cookie);
    expect(list.status).toBe(200);
    expect(list.body.map((d: { name: string }) => d.name)).toContain('design.md');
  });

  it('does not leak uploaded chunks into the global shared search', async () => {
    const res = await read(request(server()).get('/knowledge/search').query({ q: 'boundary value analysis' }));
    expect(res.status).toBe(200);
    // Every hit is from the shared corpus (a real source), never the uploaded 'design.md'.
    expect(res.body.results.every((r: { citation: { source: string } }) => r.citation.source !== 'design.md')).toBe(true);
  });

  it('requires authentication', async () => {
    expect((await request(server()).get(`/orgs/${orgId}/knowledge/documents`)).status).toBe(401);
  });

  it('hides another tenant’s org from a non-member (404)', async () => {
    const res = await request(server())
      .post(`/orgs/${orgId}/knowledge/documents`)
      .set('Cookie', auth.cookie) // the first user is NOT a member of this org
      .set('X-CSRF-Token', auth.csrf)
      .send({ name: 'x.md', type: 'md', content: 'hello world' });
    expect(res.status).toBe(404);
  });

  it('accepts PDF and DOCX files', async () => {
    const res = await request(server())
      .post(`/orgs/${orgId}/knowledge/documents`)
      .set('Cookie', member.cookie)
      .set('X-CSRF-Token', member.csrf)
      .send({ name: 'x.pdf', type: 'pdf', content: 'hello' });
    expect(res.status).toBe(201);
  });

  it('rejects an unsupported file type (422)', async () => {
    const res = await request(server())
      .post(`/orgs/${orgId}/knowledge/documents`)
      .set('Cookie', member.cookie)
      .set('X-CSRF-Token', member.csrf)
      .send({ name: 'x.png', type: 'png', content: 'hello' });
    expect(res.status).toBe(422);
  });

  it('meters EMBED usage for uploads and searches, attributed to the caller org (S16 AC-EMB-05)', async () => {
    // The uploads above embedded as this org; a search by a member attributes its query embed too.
    await request(server())
      .get('/knowledge/search')
      .set('Cookie', member.cookie)
      .query({ q: 'boundary value analysis' })
      .expect(200);

    const usage = await request(server()).get(`/orgs/${orgId}/brain/usage`).set('Cookie', member.cookie);
    expect(usage.status).toBe(200);
    const embed = (usage.body.bySurface as { surface: string; calls: number; inputTokens: number; outputTokens: number }[]).find(
      (s) => s.surface === 'EMBED',
    );
    expect(embed).toBeDefined();
    expect(embed!.calls).toBeGreaterThanOrEqual(2); // at least one upload + this search
    expect(embed!.inputTokens).toBeGreaterThan(0); // the stub's whitespace-token estimate
    expect(embed!.outputTokens).toBe(0); // embeddings produce no completion tokens
  });
});
