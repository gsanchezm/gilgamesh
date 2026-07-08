import 'reflect-metadata';
import { Logger, ShutdownSignal } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ProdAppModule } from './app.module';
import { configureBodyParser } from './common/body-parser';
import { createShutdownHandler } from './common/graceful-shutdown';
import { selectLogger } from './common/json-logger';
import { configureRequestId } from './common/request-id';
import { configureWebDist } from './common/web-dist';
import { loadConfig } from './config';
import { ShutdownState } from './health/shutdown-state';

/**
 * Production entrypoint: real Prisma/Postgres-backed server. Fails fast on bad config,
 * mounts everything under /api/v1, hardens headers (helmet), restricts CORS to an allowlist
 * (credentials enabled for the session cookie) and enables graceful shutdown so Prisma
 * disconnects cleanly on SIGTERM.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(ProdAppModule);

  // Structured logging (slice 30): swap Nest's pretty ConsoleLogger for the single-line JSON logger
  // only when LOG_FORMAT=json (deploy → Azure Log Analytics). Unset/`pretty` returns undefined here,
  // so useLogger is never called and the default pretty logger is untouched — zero change for dev.
  const logger = selectLogger(config.logFormat);
  if (logger) {
    app.useLogger(logger);
  }

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

  // Graceful shutdown (slice 29). Keep Nest's shutdown hooks for EVERY default signal EXCEPT SIGTERM
  // — Nest's own SIGTERM handler tears the app down immediately (Prisma `$disconnect` first, then the
  // HTTP server), which would defeat the drain grace. We own SIGTERM below; SIGINT (dev Ctrl+C) and
  // the rest keep Nest's existing immediate-close path, and `app.close()` still runs the same hooks.
  app.enableShutdownHooks(
    Object.values(ShutdownSignal).filter((signal) => signal !== ShutdownSignal.SIGTERM),
  );

  // On SIGTERM (ACA scaling/rolling a revision): flip readiness to `not-ready` so ACA stops routing
  // NEW traffic here, keep serving for the grace period, then `app.close()` (Nest hooks → Prisma
  // disconnect). Idempotent — a second SIGTERM during the window is ignored.
  const shutdownState = app.get(ShutdownState);
  process.on(
    'SIGTERM',
    createShutdownHandler({
      beginDraining: () => shutdownState.beginDraining(),
      close: () => app.close(),
      graceMs: config.shutdownGraceMs,
      onClosed: () => process.exit(0),
      onError: (error) => {
        Logger.error('Error during graceful shutdown', error instanceof Error ? error.stack : String(error), 'Bootstrap');
        process.exit(1);
      },
      log: (message) => Logger.log(message, 'Bootstrap'),
    }),
  );

  await app.listen(config.port);
  Logger.log(`Gilgamesh API listening on :${config.port}/api/v1 (${config.nodeEnv})`, 'Bootstrap');
}

void bootstrap();
