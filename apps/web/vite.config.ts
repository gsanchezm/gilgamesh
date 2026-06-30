/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Array form, specific-first: the `@gilgamesh/ui/styles.css` subpath must resolve to the CSS
    // file, not be swallowed by the bare `@gilgamesh/ui` -> index.ts alias (which would yield
    // `index.ts/styles.css`). Order matters — first match wins.
    alias: [
      {
        find: '@gilgamesh/ui/styles.css',
        replacement: fileURLToPath(new URL('../../packages/ui/src/styles.css', import.meta.url)),
      },
      {
        find: '@gilgamesh/domain',
        replacement: fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      },
      {
        find: '@gilgamesh/ui',
        replacement: fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      },
    ],
  },
  // Same-origin proxy so the browser talks to one origin: SameSite=lax keeps the session cookie
  // first-party on fetch POSTs (a cross-origin SPA->API split would drop it). Target = the API.
  server: {
    proxy: {
      '/api/v1': { target: process.env.E2E_API_URL ?? 'http://localhost:3001', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
