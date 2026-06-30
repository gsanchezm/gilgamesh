import type { NestExpressApplication } from '@nestjs/platform-express';
import { JSON_BODY_LIMIT } from './input-limits';

/**
 * Sets a deliberate, deterministic HTTP body-size limit on both the JSON and urlencoded parsers
 * ({@link JSON_BODY_LIMIT}). Nest's Express adapter otherwise defaults to body-parser's 100 KiB,
 * which is *smaller* than the 256 KiB `feature.content` a valid request may carry — so without this
 * the largest valid feature would 413 before validation (audit #2). Called from both the production
 * bootstrap (`main.ts`) and the e2e harness so the limit is identical and verifiable.
 *
 * Must run before `app.init()` (Nest registers its default parsers during init; `useBodyParser`
 * overrides them).
 */
export function configureBodyParser(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: JSON_BODY_LIMIT });
}
