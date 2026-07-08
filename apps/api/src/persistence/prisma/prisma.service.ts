import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { connectWithRetry, poolDefaultsFromEnv, withPoolDefaults } from './pool-config';

/**
 * Prisma client for the production / integration wiring.
 *
 * Slice 31: the base DATABASE_URL (read from env — the repo's `*FromEnv` infra idiom) is augmented
 * with bounded, absent-only pool defaults (`connection_limit` / `pool_timeout` / `connect_timeout`)
 * and passed via the runtime `datasourceUrl` override. schema.prisma is untouched, so `prisma
 * migrate` — which reads the schema's `env("DATABASE_URL")` directly — is unaffected. When
 * DATABASE_URL is unset we pass NO override and let Prisma resolve the datasource exactly as before
 * (zero behavior change). `onModuleInit` gains a small bounded connect-retry for a scale-to-zero
 * cold wake; on exhaustion the error surfaces clearly (never swallowed).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = withPoolDefaults(process.env.DATABASE_URL, poolDefaultsFromEnv());
    super(url ? { datasourceUrl: url } : {});
  }

  async onModuleInit(): Promise<void> {
    await connectWithRetry(() => this.$connect(), {
      // Detail-free by design: a Prisma connect error can embed the DSN (credentials). The final
      // rethrow (on exhaustion) surfaces Prisma's own error unmodified — we don't log it ourselves.
      onRetry: (attempt, delayMs) =>
        this.logger.warn(`Database connect attempt ${attempt} failed; retrying in ${delayMs}ms`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
