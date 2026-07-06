import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@gilgamesh/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@gilgamesh/application': fileURLToPath(
        new URL('../../packages/application/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests (require Docker Postgres) run via `pnpm test:int`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Sweep e2e re-register users across tests; the 429 path is proven by a dedicated test
    // that overrides RATE_LIMIT to a tiny value. BRAIN_MODE=offline keeps the suite on the
    // deterministic stub brain even when the machine env carries ANTHROPIC_API_KEY (S9);
    // EMAIL_MODE=offline does the same for the recording mail stub vs SMTP_URL (S17);
    // PAYMENTS_MODE=offline keeps the mock payment provider vs STRIPE_SECRET_KEY (S13).
    env: { AUTH_RATE_LIMIT: '1000000', BRAIN_MODE: 'offline', EMAIL_MODE: 'offline', PAYMENTS_MODE: 'offline' },
  },
});
