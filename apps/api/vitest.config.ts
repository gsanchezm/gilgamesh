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
  },
});
