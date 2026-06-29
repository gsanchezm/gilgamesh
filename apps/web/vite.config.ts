/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gilgamesh/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@gilgamesh/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
