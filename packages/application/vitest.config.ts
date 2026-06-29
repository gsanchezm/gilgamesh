import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@gilgamesh/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
});
