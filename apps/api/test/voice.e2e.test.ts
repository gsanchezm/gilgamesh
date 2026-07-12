import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { type Auth, authFrom } from './support/auth';

/**
 * Slice 42 — voice STT/TTS API e2e (Docker-free, in-memory persistence, VOICE_MODE=offline so the
 * DeterministicVoice stub answers — no network). Proves the routes exist, share the chat auth/CSRF/
 * project-scope, and that a non-member gets 404 (AC-VOICE-04) while the unconfigured provider serves
 * a real 200 from the stub (AC-VOICE-05, never 500).
 */
let app: INestApplication;
let auth: Auth;
let projectId: string;
let sessionId: string;

const AUDIO = { data: Buffer.from('hello pantheon').toString('base64'), mimeType: 'audio/webm' };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'I', lastName: 'U', email: 'voice@uruk.io', password: 'C0rrect-Horse!' });
  auth = authFrom(reg);

  const proj = await request(app.getHttpServer())
    .post('/projects')
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName: 'OmniPizza', format: 'BDD' });
  projectId = proj.body.projectId;

  const sess = await request(app.getHttpServer())
    .post(`/projects/${projectId}/chat`)
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({});
  sessionId = sess.body.id;
});

afterAll(async () => {
  await app.close();
});

const server = () => app.getHttpServer();
const mutate = (req: request.Test) => req.set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);

describe('Voice API', () => {
  it('transcribes audio → text (200, stub, non-empty) — AC-VOICE-05 (never 500)', async () => {
    const res = await mutate(request(server()).post(`/chat/${sessionId}/transcribe`)).send({ audio: AUDIO });
    expect(res.status).toBe(200);
    expect(typeof res.body.text).toBe('string');
    expect(res.body.text.length).toBeGreaterThan(0);
    // Deterministic: the same clip yields the same transcript (AC-VOICE-01).
    const again = await mutate(request(server()).post(`/chat/${sessionId}/transcribe`)).send({ audio: AUDIO });
    expect(again.body.text).toBe(res.body.text);
  });

  it('synthesizes text → audio (200, base64 + mime)', async () => {
    const res = await mutate(request(server()).post(`/chat/${sessionId}/speak`)).send({ text: 'Zeus here.' });
    expect(res.status).toBe(200);
    expect(res.body.audio.mimeType).toMatch(/^audio\//);
    expect(res.body.audio.data.length).toBeGreaterThan(0);
  });

  it('requires authentication (401) on both routes', async () => {
    expect((await request(server()).post(`/chat/${sessionId}/transcribe`).send({ audio: AUDIO })).status).toBe(401);
    expect((await request(server()).post(`/chat/${sessionId}/speak`).send({ text: 'hi' })).status).toBe(401);
  });

  it('rejects a mutation without the CSRF token (403)', async () => {
    const res = await request(server()).post(`/chat/${sessionId}/transcribe`).set('Cookie', auth.cookie).send({ audio: AUDIO });
    expect(res.status).toBe(403);
  });

  it('validates the body (422): missing audio / empty text', async () => {
    expect((await mutate(request(server()).post(`/chat/${sessionId}/transcribe`)).send({})).status).toBe(422);
    expect((await mutate(request(server()).post(`/chat/${sessionId}/speak`)).send({ text: '' })).status).toBe(422);
  });

  it('404s a missing session', async () => {
    const missing = randomUUID();
    expect((await mutate(request(server()).post(`/chat/${missing}/transcribe`)).send({ audio: AUDIO })).status).toBe(404);
    expect((await mutate(request(server()).post(`/chat/${missing}/speak`)).send({ text: 'hi' })).status).toBe(404);
  });

  it('a non-member gets 404, not 403 — session existence is not leaked (AC-VOICE-04)', async () => {
    const reg = await request(server())
      .post('/auth/register')
      .send({ firstName: 'N', lastName: 'O', email: 'owner@nippur.io', password: 'C0rrect-Horse!' });
    const foreign = authFrom(reg);
    const t = await request(server())
      .post(`/chat/${sessionId}/transcribe`)
      .set('Cookie', foreign.cookie)
      .set('X-CSRF-Token', foreign.csrf)
      .send({ audio: AUDIO });
    expect(t.status).toBe(404);
    const s = await request(server())
      .post(`/chat/${sessionId}/speak`)
      .set('Cookie', foreign.cookie)
      .set('X-CSRF-Token', foreign.csrf)
      .send({ text: 'hi' });
    expect(s.status).toBe(404);
  });
});
