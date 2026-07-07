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
