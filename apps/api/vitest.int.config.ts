import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests against a real Postgres (docker compose up -d postgres).
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
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public',
      // S9/S13: the integration suite stays on the deterministic stubs — no network, ever.
      BRAIN_MODE: 'offline',
      PAYMENTS_MODE: 'offline',
      // S15: the deterministic StubIdentityProvider answers the SSO routes — no Google, ever.
      SSO_MODE: 'offline',
      // S17: same for mail — the recording stub, never an SMTP connection.
      EMAIL_MODE: 'offline',
      // S20: the in-memory secret-vault stub — an EXPLICIT opt-in (the selector refuses to
      // boot unconfigured); never Azure, even when the machine env carries AZURE_KEY_VAULT_URL.
      VAULT_MODE: 'offline',
      // S42: the DeterministicVoice stub — the int suite never reaches Azure Speech.
      VOICE_MODE: 'offline',
    },
  },
});
