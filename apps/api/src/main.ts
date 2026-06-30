import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { ProdAppModule } from './app.module';
import { configureBodyParser } from './common/body-parser';
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
  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`Gilgamesh API listening on :${config.port}/api/v1 (${config.nodeEnv})`, 'Bootstrap');
}

void bootstrap();
