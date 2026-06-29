import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@gilgamesh/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
});
