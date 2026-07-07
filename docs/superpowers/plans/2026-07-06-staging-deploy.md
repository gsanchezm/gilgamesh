# Staging Deploy (Azure Container Apps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Gilgamesh to a first deployed environment (staging) on Azure Container Apps per `specs/infra/staging-deploy.md` (owner decisions SD-1..4).

**Architecture:** One container = API + built SPA behind a `WEB_DIST_DIR` flag (same origin, `__Host-` cookies/CSRF unchanged); entrypoint runs `prisma migrate deploy` before boot; bicep v2 provisions UAMI + LAW + ACR + Key Vault + Postgres Flexible (pgvector) + a single Container App (scale 0..1, no Redis); everything not yet used (Service Bus, Blob, runners) is param-gated off. Deploy is two-phase (`deployApp`).

**Tech Stack:** NestJS 11 / Express 5, Vitest 3 + supertest, Vite 6, Docker (node:22-bookworm-slim + pnpm via corepack), Bicep, Playwright.

## Global Constraints

- pnpm `11.9.0` (root `packageManager` pin), node `>=22`. Worktrees via `pnpm wt <branch>` under `.worktrees/`.
- **No keystone changes** — this work adds zero vocabulary/entities/routes.
- The flag `WEB_DIST_DIR` absent ⇒ **zero behavior change** (dev, all 4 test harnesses, CI stay untouched).
- Excluded prefixes for SPA fallback are exactly `/api/v1` and `/health` (spec §3). Prod health lives at **`/api/v1/health`** (`setGlobalPrefix` has no exclusions — probes use that path).
- API tests are Docker-free by default; `apps/api/test/*.e2e.test.ts` run in the default suite (`pnpm --filter @gilgamesh/api test`).
- All harness offline pins (`BRAIN/SSO/EMAIL/PAYMENTS/VAULT_MODE=offline`) stay as-is; the Docker image sets **none** of them.
- Stack gates (int/BDD/Playwright): fresh servers (kill 3001/5173 first), one worktree at a time, FOREGROUND.
- Commit style: conventional commits, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session` trailer.

---

## Stream A — worktree `feat-staging-deploy` (F1: app code)

### Task A1: `WEB_DIST_DIR` in config

**Files:**
- Modify: `apps/api/src/config.ts` (add `webDistDir` to the parsed config)
- Test: `apps/api/src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env).webDistDir: string | undefined` — trimmed value of `env.WEB_DIST_DIR`, `undefined` when absent/blank. No existence validation here (that belongs to `configureWebDist`, Task A2, so `loadConfig` stays a pure env parser).

- [ ] **Step 1: Write the failing tests** — append to the existing `describe` in `apps/api/src/config.test.ts`, mirroring its style:

```ts
it('parses WEB_DIST_DIR trimmed, undefined when absent or blank', () => {
  expect(loadConfig({ ...base, WEB_DIST_DIR: '  /app/apps/web/dist  ' }).webDistDir).toBe(
    '/app/apps/web/dist',
  );
  expect(loadConfig(base).webDistDir).toBeUndefined();
  expect(loadConfig({ ...base, WEB_DIST_DIR: '   ' }).webDistDir).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gilgamesh/api test -- src/config.test.ts` → FAIL (`webDistDir` not on the config type).
- [ ] **Step 3: Implement** — in `apps/api/src/config.ts`, add to the returned object and its type:

```ts
/** Absolute path of the built SPA (vite dist). Absent = the API serves no static web (default). */
const webDistDir = env.WEB_DIST_DIR?.trim() || undefined;
```

- [ ] **Step 4: Re-run the test file** → PASS.
- [ ] **Step 5: Commit** — `feat(api): WEB_DIST_DIR config (staging SPA serving, spec SD-3)`.

### Task A2: `configureWebDist` — static + SPA fallback

**Files:**
- Create: `apps/api/src/common/web-dist.ts`
- Test: `apps/api/test/web-dist.e2e.test.ts`

**Interfaces:**
- Consumes: nothing from A1 (takes the dir as an argument).
- Produces: `configureWebDist(app: NestExpressApplication, webDistDir: string): void` — throws `Error` at call time if `<dir>/index.html` is missing.

**Behavior contract (spec §3, refined):**
1. Serves files from `webDistDir` (`express.static`, `index: false`).
2. **Immutable caching only for hashed bundles**: `Cache-Control: public, max-age=31536000, immutable` for `.js`/`.css` under `assets/`. (Refinement over spec §3: `dist/assets/` also receives *unhashed* copies of `apps/web/public/assets/*` images — those must NOT be immutable; they keep express.static's default ETag revalidation.)
3. `index.html` always `Cache-Control: no-cache` (via static setHeaders AND the fallback).
4. SPA fallback: any **GET** whose path is not `/api/v1`(`/…`) nor `/health`(`/…`) → `index.html`. Non-GET methods pass through untouched.
5. `/api/v1/*` unknown paths keep returning the API's JSON 404 — never HTML.
6. Missing `index.html` ⇒ throw (fail-fast boot).

- [ ] **Step 1: Write the failing e2e test** — `apps/api/test/web-dist.e2e.test.ts`. Build a fixture dist in a temp dir; mirror the app-bootstrap pattern of `apps/api/test/rate-limit.e2e.test.ts` but with the prod global prefix:

```ts
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
  await app.close();
  rmSync(dist, { recursive: true, force: true });
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
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @gilgamesh/api test -- test/web-dist.e2e.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** — `apps/api/src/common/web-dist.ts`:

```ts
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';

/** Prefixes the SPA fallback must never intercept (spec staging-deploy §3). */
const EXCLUDED_PREFIXES = ['/api/v1', '/health'];

const isExcluded = (path: string): boolean =>
  EXCLUDED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/** Hashed vite bundles are content-addressed → safe to cache forever. Unhashed files (public/
 * assets copied verbatim into dist/assets) must revalidate, so only js/css qualify. */
const isImmutableAsset = (filePath: string): boolean =>
  ['.js', '.css'].includes(extname(filePath));

/**
 * Serve the built SPA from the API process (owner decision SD-3: one container, one origin, so
 * `__Host-` cookies + the CSRF double-submit behave exactly as in the Playwright harness).
 * Registered as Express middleware, which runs BEFORE the Nest router — hence the explicit
 * exclusion list instead of relying on route precedence.
 */
export function configureWebDist(app: NestExpressApplication, webDistDir: string): void {
  const indexHtml = join(webDistDir, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(
      `Config error: WEB_DIST_DIR "${webDistDir}" has no index.html — did the web build run?`,
    );
  }
  const server = app.getHttpAdapter().getInstance();

  server.use(
    express.static(webDistDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (isImmutableAsset(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  server.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' || isExcluded(req.path)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
```

- [ ] **Step 4: Re-run the test file** → all 7 PASS. Also run the full Docker-free api suite (`pnpm --filter @gilgamesh/api test`) to prove zero regression.
- [ ] **Step 5: Commit** — `feat(api): serve the built SPA behind WEB_DIST_DIR (static + SPA fallback, spec SD-3)`.

### Task A3: wire into `main.ts`

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step 1: Implement** — after `app.enableCors(...)` in `bootstrap()`:

```ts
// Staging/prod single-container mode (spec staging-deploy SD-3): serve the built SPA from this
// process when WEB_DIST_DIR is set. Absent (dev, every test harness) = API-only, unchanged.
if (config.webDistDir) {
  configureWebDist(app, config.webDistDir);
}
```

with `import { configureWebDist } from './common/web-dist';`.

- [ ] **Step 2: Verify** — `pnpm --filter @gilgamesh/api typecheck` clean · `pnpm -r lint` (or the workspace lint filter used by CI) clean · full `pnpm --filter @gilgamesh/api test` green.
- [ ] **Step 3: Commit** — `feat(api): wire WEB_DIST_DIR into the production bootstrap`.

---

## Stream B — worktree `feat-staging-image` (F2 authoring; validation is Task M2 post-merge)

### Task B1: `.dockerignore` + entrypoint + `Dockerfile`

**Files:**
- Create: `.dockerignore`, `docker/entrypoint.sh`, `Dockerfile`

- [ ] **Step 1: `.dockerignore`** (build-context hygiene; the repo dir on this machine also holds gitignored heavyweights that must not reach the daemon):

```
.git
.worktrees
node_modules
**/node_modules
**/dist
**/.turbo
**/test-results
**/playwright-report
design_handoff_gilgamesh
rag
PROJECT_STATUS.html
ORCHESTRATION_PLAN.md
.env
**/.env
Dockerfile
docker-compose*.yml
```

- [ ] **Step 2: `docker/entrypoint.sh`** (POSIX sh; invoked via `sh` so no exec bit needed from a Windows checkout):

```sh
#!/bin/sh
# Staging entrypoint (spec staging-deploy §3): apply migrations, then boot the API.
# A failed migration fails the container visibly (Log Analytics) instead of booting stale.
set -e
cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
exec node -r @swc-node/register src/main.ts
```

- [ ] **Step 3: `Dockerfile`** (two stages; runtime executes TS via swc-node — same mechanism as `start:dev`; AOT build is a recorded follow-up):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
# packageManager pin (pnpm@11.9.0) drives corepack; allowBuilds in pnpm-workspace.yaml covers
# the native builders (esbuild, @swc/core, argon2 prebuilds resolve per-platform here, on linux).
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @gilgamesh/api prisma:generate \
 && pnpm --filter @gilgamesh/web build

FROM node:22-bookworm-slim
# openssl: Prisma engine requirement on debian-slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production \
    API_PORT=3001 \
    WEB_DIST_DIR=/app/apps/web/dist
EXPOSE 3001
USER node
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
```

- [ ] **Step 4: Commit** — `build(docker): staging image (pnpm workspace build -> swc-node runtime, migrate-on-boot)`.

### Task B2: local staging compose + container smoke spec

**Files:**
- Create: `docker-compose.staging.yml`, `apps/web/playwright.staging.config.ts`, `apps/web/e2e/staging-smoke.spec.ts`

**Interfaces:**
- Consumes: the image from B1; `WEB_DIST_DIR` behavior from A2 (merged before validation).

- [ ] **Step 1: `docker-compose.staging.yml`** (root). NOTE the deliberate delta: local validation cannot exercise the Azure vault (Managed Identity), and S20 refuses `VAULT_MODE=offline` under `NODE_ENV=production` — so locally the container runs `NODE_ENV=development` + `VAULT_MODE=offline`. Everything else (migrations, static serving, same-origin session/CSRF, stub degradation) is validated for real:

```yaml
# Local validation of the STAGING IMAGE (spec staging-deploy §4). Not a dev environment.
# Delta vs Azure: NODE_ENV/VAULT_MODE — the prod-like vault path needs Managed Identity (S20).
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: gilgamesh
      POSTGRES_PASSWORD: gilgamesh
      POSTGRES_DB: gilgamesh
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U gilgamesh -d gilgamesh']
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    build: .
    ports:
      - '3001:3001'
    environment:
      DATABASE_URL: postgresql://gilgamesh:gilgamesh@postgres:5432/gilgamesh?schema=public
      NODE_ENV: development
      VAULT_MODE: offline
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 2: `apps/web/playwright.staging.config.ts`** — no `webServer` (the container is the server), one project:

```ts
import { defineConfig, devices } from '@playwright/test';

/** Smoke against the STAGING IMAGE (docker-compose.staging.yml) or a real staging URL.
 * Run: docker compose -f docker-compose.staging.yml up -d --build
 *      pnpm --filter @gilgamesh/web exec playwright test --config playwright.staging.config.ts
 * Override target: STAGING_BASE_URL=https://<app>.azurecontainerapps.io */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'staging-smoke.spec.ts',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.STAGING_BASE_URL ?? 'http://localhost:3001',
    ...devices['Desktop Chrome'],
  },
});
```

- [ ] **Step 3: `apps/web/e2e/staging-smoke.spec.ts`** — read the existing `apps/web/e2e/` specs first and reuse their selectors/helpers verbatim (they are the source of truth for the register→onboarding→dashboard flow). The spec must assert, in one browser session against `baseURL`:
  1. `GET /` renders the SPA login (helix hero visible) — served by the API container;
  2. register a fresh unique user via the UI (`/register`), complete onboarding, land on the agent room;
  3. one authenticated API round-trip works same-origin (e.g. toggle an agent or open Test Lab);
  4. `request.get('/api/v1/definitely-not-a-route')` → status 404 with JSON content-type (fallback never swallows the API);
  5. a client-route deep link (`page.goto('/knowledge')` after login) renders the SPA, not a 404.

- [ ] **Step 4: Commit** — `test(e2e): staging-image compose + Playwright smoke (container serves SPA+API)`.

---

## Stream C — worktree `feat-staging-bicep` (F3: bicep v2)

### Task C1: `infra/bicep/main.bicep` v2

**Files:**
- Modify: `infra/bicep/main.bicep`

**Requirements (spec §2/§5/§8):**
- [ ] Params: `env` `@allowed(['qa','staging'])` default `'staging'`; **new** `deployApp bool = false`, `appImage string = ''`, `deployServiceBus bool = false`, `deployBlob bool = false`, `anthropicApiKey @secure() string = ''`. Drop the runner image params (`chaosProxyImage` etc. move behind `deployRunners bool = false` in the module, default off).
- [ ] Gate modules: `serviceBus` and `blob` behind `if (deployServiceBus)` / `if (deployBlob)`; `containerApps` behind `if (deployApp)` (two-phase first deploy, spec §8). Outputs referencing gated modules must tolerate absence (conditional expressions / empty-string defaults).
- [ ] Key Vault secrets: keep `db-connection-string` + `session-secret`; `anthropic-api-key` created **only** `if (!empty(anthropicApiKey))` — and the containerApps module binds the env var only when told the key exists (pass `hasAnthropicKey: !empty(anthropicApiKey)`). This closes the spec-§5 caveat (a placeholder value must never select the real brain).
- [ ] Update the header comment: staging is deployable (owner decisions SD-1..4, 2026-07-06); keep the QA design notes.
- [ ] Commit — `infra(bicep): v2 staging — two-phase deployApp, SB/Blob/runners gated off, guarded anthropic key`.

### Task C2: `infra/bicep/modules/containerApps.bicep` v2

**Files:**
- Modify: `infra/bicep/modules/containerApps.bicep`

**Requirements:**
- [ ] Single app `app` (API+SPA). Remove/gate `workers`, `chaos-proxy`, `plugin-playwright`, `omnipizza` behind `deployRunners bool = false` (keep the code — TOM will return; `if (deployRunners)` on each resource) and remove the Service-Bus KEDA scale rule from the default path.
- [ ] App container env — the REAL names the app reads (spec §5 matrix): `NODE_ENV=production` (belt+braces with the image), `API_PORT='3001'`, `AZURE_KEY_VAULT_URL=<keyVaultUri>`, `AZURE_CLIENT_ID=<uami clientId>`, `CORS_ORIGINS=''`, `DATABASE_URL` (secretRef `db-connection-string`), `SESSION_SECRET` (secretRef `session-secret`), and — only when `hasAnthropicKey` — `ANTHROPIC_API_KEY` (secretRef `anthropic-api-key`). **No** `REDIS_URL`, no `*_MODE`, none of the legacy `LLM_API_KEY`/`KEY_VAULT_URI`/`PORT`/Blob/SB vars.
- [ ] Ingress external, `targetPort: 3001`, `transport: 'auto'`; scale `minReplicas: 0`, `maxReplicas: 1` with an inline comment stating the invariant: *max 1 replica while rate-limit/SSO-state are in-memory; raising it requires REDIS_URL first*.
- [ ] Probes on **`/api/v1/health`** port 3001: `Startup` (periodSeconds 5, failureThreshold 24 — cold start + migrations headroom) and `Liveness` (periodSeconds 30).
- [ ] Resources `cpu: 0.5 / memory: 1Gi`; `activeRevisionsMode: 'Single'`; ACR pull + KV secretRefs via the UAMI (existing pattern).
- [ ] Commit — `infra(bicep): containerApps v2 — single app serving SPA+API, real env matrix, /api/v1/health probes`.

### Task C3: postgres pgvector allowlist + Key Vault data-plane role

**Files:**
- Modify: `infra/bicep/modules/postgres.bicep`, `infra/bicep/modules/keyVault.bicep`

- [ ] **postgres.bicep:** ensure the migration's `CREATE EXTENSION vector` can run — add (if not already present):

```bicep
resource allowVector 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: { value: 'VECTOR', source: 'user-override' }
}
```

- [ ] **keyVault.bicep:** the S20 `AzureKeyVaultSecretVault` WRITES secrets at runtime (BYOK `vault.put`). Verify the UAMI role assignment: if it only grants *Key Vault Secrets User* (read), add **Key Vault Secrets Officer** (`b86a8fe4-44ce-4948-aee5-eccb2c155cd7`) for the workload identity. Keep RBAC mode + purge protection as-is.
- [ ] **Validation (whole stream):** `az bicep build -f infra/bicep/main.bicep` (if `az`/`bicep` CLI is available on this machine) must compile clean; otherwise record that compilation happens at F4 phase 1 and rely on review.
- [ ] Commit — `infra(bicep): pgvector allowlist + KV Secrets Officer for the S20 runtime vault`.

---

## Serial tasks (main checkout, orchestrator — FOREGROUND)

### Task M1: review + merge Stream A
- [ ] Adversarial review (subagent, fresh eyes) of the A diff: correctness of the exclusion logic, header contract, fail-fast, zero-regression claim.
- [ ] Gates on the worktree (fresh servers, foreground): typecheck · lint · full Docker-free sweep · `test:int` · `test:bdd` · Playwright. (No schema change ⇒ no new migration to `db:deploy`, but run the standing checklist anyway.)
- [ ] FF-merge `feat-staging-deploy` → `main`; re-run typecheck + api tests on main.

### Task M2: review + merge Stream B, then validate the image locally
- [ ] Adversarial review of the B diff (Dockerfile layer hygiene, .dockerignore completeness, compose env delta documented, smoke assertions).
- [ ] Rebase B onto post-A main; FF-merge.
- [ ] Validate (needs Docker Desktop): `docker compose -f docker-compose.staging.yml up -d --build` → container healthy (migrations applied) → `pnpm --filter @gilgamesh/web exec playwright test --config playwright.staging.config.ts` → 5 assertions green → `docker compose -f docker-compose.staging.yml down -v`.
- [ ] Fix-forward anything the smoke catches (helmet CSP is the known suspect — if the SPA is blocked, scope a CSP override inside `configureWebDist` and re-run).

### Task M3: review + merge Stream C
- [ ] Adversarial review of the bicep diff against the spec §5 env matrix (names byte-exact vs `loadConfig`/selectors) + the §8 two-phase contract.
- [ ] `az bicep build` if available; FF-merge (no app code — typecheck/lint/unit quick pass on main).

### Task M4: F5 docs + push
- [ ] Update: CLAUDE.md (staging section) · `docs/research/feature-status.md` board · PROJECT_STATUS.html · decisions-log results · status memory. Push `main` (spec commit `61eba00` + plan + merges) to origin.

### Task M5: F4 gate — STOP for the owner
- [ ] Everything local is green. Ask the owner for `! az login` (+ subscription) and the go for phase 1; execute the §8 runbook under supervision; post-deploy smoke via `STAGING_BASE_URL=<url> playwright test --config playwright.staging.config.ts` + cookie-flag verification on the real HTTPS origin.
