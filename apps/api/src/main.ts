import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ProdAppModule } from './app.module';
import { loadConfig } from './config';

/**
 * Production entrypoint: real Prisma/Postgres-backed server. Fails fast on bad config,
 * mounts everything under /api/v1, hardens headers (helmet), restricts CORS to an allowlist
 * (credentials enabled for the session cookie) and enables graceful shutdown so Prisma
 * disconnects cleanly on SIGTERM.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(ProdAppModule);

  // Behind a reverse proxy / load balancer, trust the first hop so req.ip is the real client IP
  // (the rate-limit key depends on it; without this it collapses to the proxy address).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
