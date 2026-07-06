import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { JSON_BODY_LIMIT } from './input-limits';

// The webhook prefix in both compositions: bare (the Docker-free e2e harness) and under the
// /api/v1 global prefix (production, BDD, Playwright). Express `use(path, …)` matches by prefix.
const WEBHOOK_PATHS = ['/billing/webhooks', '/api/v1/billing/webhooks'];

/**
 * Sets a deliberate, deterministic HTTP body-size limit on both the JSON and urlencoded parsers
 * ({@link JSON_BODY_LIMIT}). Nest's Express adapter otherwise defaults to body-parser's 100 KiB,
 * which is *smaller* than the 256 KiB `feature.content` a valid request may carry — so without this
 * the largest valid feature would 413 before validation (audit #2). Called from both the production
 * bootstrap (`main.ts`) and the e2e harness so the limit is identical and verifiable.
 *
 * Provider webhooks (slice 13, keystone §6) are signature-verified over the RAW request bytes, so
 * `/billing/webhooks/*` is parsed as an opaque Buffer BEFORE the JSON parser (body-parser skips a
 * body another parser already consumed). Same limit — an oversized delivery still maps to 413
 * through the same filter.
 *
 * Must run before `app.init()` (Nest registers its default parsers during init; `useBodyParser`
 * overrides them).
 */
export function configureBodyParser(app: NestExpressApplication): void {
  app.use(WEBHOOK_PATHS, express.raw({ type: () => true, limit: JSON_BODY_LIMIT }));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: JSON_BODY_LIMIT });
}
