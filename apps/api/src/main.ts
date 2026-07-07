import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ProdAppModule } from './app.module';
import { configureBodyParser } from './common/body-parser';
import { configureRequestId } from './common/request-id';
import { configureWebDist } from './common/web-dist';
import { loadConfig } from './config';

/**
 * Production entrypoint: real Prisma/Postgres-backed server. Fails fast on bad config,
 * mounts everything under /api/v1, hardens headers (helmet), restricts CORS to an allowlist
 * (credentials enabled for the session cookie) and enables graceful shutdown so Prisma
 * disconnects cleanly on SIGTERM.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(ProdAppModule);

  // Correlation id (slice 24): assign every request an X-Request-Id BEFORE any other middleware so
  // even a body-parser error carries it. Echoed on the response, quoted in the RFC9457 error body,
  // and logged with the stack on an unmapped 500 — the join key between a client error and the logs.
  configureRequestId(app);

  // Deterministic body-size limit (large enough for the biggest valid .feature; see input-limits).
  // Must run before any request is handled — main.ts never calls app.init() directly, listen() does.
  configureBodyParser(app);

  // Behind a reverse proxy / load balancer, trust exactly the configured number of hops so req.ip
  // is the real client IP (the rate-limit key depends on it). Validated config, not hardcoded — a
  // wrong hop count lets a directly-reachable API trust an attacker-supplied X-Forwarded-For.
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });

  // Staging/prod single-container mode (spec staging-deploy SD-3): serve the built SPA from this
  // process when WEB_DIST_DIR is set. Absent (dev, every test harness) = API-only, unchanged.
  if (config.webDistDir) {
    configureWebDist(app, config.webDistDir);
  }

  // Redis-less production is a deliberate staging posture (spec staging-deploy §2), valid ONLY
  // while a single replica runs — surface it on every boot so it can't be forgotten silently.
  if (config.nodeEnv === 'production' && !config.redisUrl) {
    Logger.warn(
      'REDIS_URL is not set — rate-limit and SSO state use in-memory stores (correct only single-replica).',
      'Bootstrap',
    );
  }

  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`Gilgamesh API listening on :${config.port}/api/v1 (${config.nodeEnv})`, 'Bootstrap');
}

void bootstrap();
