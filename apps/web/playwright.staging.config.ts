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
