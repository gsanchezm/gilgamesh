import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5173;
const API_PORT = 3001;
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Browser e2e against the REAL stack: production API bootstrap (main.ts -> ProdAppModule, Prisma,
 * Secure/__Host- cookies, helmet, /api/v1) behind the vite dev server's same-origin proxy. This is
 * the only layer that exercises real cookie semantics (Secure, __Host-, SameSite) + the client's
 * CSRF double-submit and /auth/me restore — none of which supertest/BDD can vouch for.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Production bootstrap: real Secure cookies, helmet, /api/v1. AUTH_RATE_LIMIT is raised
      // (as cucumber.cjs does) because trust-proxy + the proxy collapse req.ip to one address.
      command: 'pnpm --filter @gilgamesh/api start:dev',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        DATABASE_URL,
        REDIS_URL,
        API_PORT: String(API_PORT),
        AUTH_RATE_LIMIT: '1000000',
        CORS_ORIGINS: '',
        NODE_ENV: 'development',
        // S9/S13: the browser e2e runs against the deterministic stubs — no network calls.
        BRAIN_MODE: 'offline',
        PAYMENTS_MODE: 'offline',
        // S15: the deterministic StubIdentityProvider answers the SSO routes — no Google calls.
        SSO_MODE: 'offline',
        // S17: the recording mail stub — never an SMTP connection.
        EMAIL_MODE: 'offline',
        // S20: the in-memory secret-vault stub — an EXPLICIT opt-in (the selector refuses to
        // boot unconfigured, never a silent stub); the e2e stack never reaches Azure.
        VAULT_MODE: 'offline',
      },
    },
    {
      command: `pnpm --filter @gilgamesh/web dev -- --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: { E2E_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
