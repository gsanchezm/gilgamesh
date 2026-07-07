import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureWebDist } from '../src/common/web-dist';

let app: INestApplication;
let dist: string;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'gx-webdist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root">gx-spa</div>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'app-C3PO1234.js'), 'console.log("bundle")');
  writeFileSync(join(dist, 'assets', 'browser-firefox.png'), 'not-really-a-png');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1'); // mirror main.ts so the exclusion logic is exercised for real
  configureWebDist(app as NestExpressApplication, dist);
  await app.init();
});

afterAll(async () => {
  // Guarded: a beforeAll failure would otherwise mask the root error with a TypeError here.
  if (app !== undefined) await app.close();
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true });
});

describe('WEB_DIST_DIR serving (spec staging-deploy §3)', () => {
  it('serves index.html at / with no-cache', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('gx-spa');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed bundles under /assets with immutable caching', async () => {
    const res = await request(app.getHttpServer()).get('/assets/app-C3PO1234.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves unhashed public images under /assets WITHOUT immutable caching', async () => {
    const res = await request(app.getHttpServer()).get('/assets/browser-firefox.png');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control'] ?? '').not.toContain('immutable');
  });

  it('falls back to index.html for client routes', async () => {
    const res = await request(app.getHttpServer()).get('/projects/p1/lab');
    expect(res.status).toBe(200);
    expect(res.text).toContain('gx-spa');
  });

  it('never intercepts /api/v1/*: unknown API path stays a JSON 404, not HTML', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('json');
    expect(res.text).not.toContain('gx-spa');
  });

  it('never intercepts non-GET methods', async () => {
    const res = await request(app.getHttpServer()).post('/projects/p1/lab');
    expect(res.status).toBe(404); // Nest router 404, not the SPA
    expect(res.text).not.toContain('gx-spa');
  });

  it('throws at configure time when index.html is missing (fail-fast boot)', () => {
    expect(() =>
      configureWebDist(app as NestExpressApplication, join(tmpdir(), 'gx-empty-nope')),
    ).toThrow(/index\.html/);
  });

  it('keeps /health excluded from the fallback: JSON, never the SPA shell (a mispointed probe must fail loudly, not fake-green on index.html)', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(404); // prod serves health only at /api/v1/health (global prefix)
    expect(res.headers['content-type']).toContain('json');
    expect(res.text).not.toContain('gx-spa');
  });

  it('excludes on the path-segment boundary only: /api/v1x is NOT excluded and gets the SPA', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1x');
    expect(res.status).toBe(200);
    expect(res.text).toContain('gx-spa');
  });

  it('serves index.html with no-cache on the direct static path too', async () => {
    const res = await request(app.getHttpServer()).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});

describe('WEB_DIST_DIR absent (the default): zero behavior change', () => {
  it('serves no SPA — GET / stays a JSON 404 exactly as today', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const bare = moduleRef.createNestApplication<NestExpressApplication>();
    bare.setGlobalPrefix('api/v1');
    await bare.init();
    try {
      const res = await request(bare.getHttpServer()).get('/');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('json');
      expect(res.text).not.toContain('gx-spa');
    } finally {
      await bare.close();
    }
  });
});
