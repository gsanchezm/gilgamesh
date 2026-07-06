import type { Clock } from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/csrf.guard';
import { InMemoryRateLimitStore } from './auth/in-memory-rate-limit-store';
import { RATE_LIMIT_STORE } from './auth/rate-limit-store';
import { RATE_LIMIT, RateLimitGuard } from './auth/rate-limit.guard';
import { RedisRateLimitStore } from './auth/redis-rate-limit-store';
import { SecurityModule } from './auth/security.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { buildValidationPipe } from './common/validation.pipe';
import { rateLimitFromEnv } from './config';
import { HealthController } from './health.controller';
import { OrgsModule } from './orgs/orgs.module';
import { PersistenceModule } from './persistence/persistence.module';
import { PrismaPersistenceModule } from './persistence/prisma/prisma-persistence.module';
import { TOKENS } from './persistence/tokens';
import { BillingModule } from './billing/billing.module';
import { BrainModule } from './brain/brain.module';
import { ChatModule } from './chat/chat.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ProjectsModule } from './projects/projects.module';
import { RunsModule } from './runs/runs.module';
import { TestLabModule } from './testlab/testlab.module';

// The two compositions differ ONLY in the persistence wiring; controllers, guards, the
// validation pipe and the domain->Problem filter are identical across both.
const FEATURE_MODULES = [
  SecurityModule,
  AuthModule,
  ProjectsModule,
  AgentsModule,
  OrgsModule,
  TestLabModule,
  RunsModule,
  BillingModule,
  KnowledgeModule,
  IntegrationsModule,
  ChatModule,
  BrainModule,
];

/** Shared global providers — reused by the BDD/int harnesses so they enforce the same pipe,
 *  CSRF guard and exception filter as production. */
export const APP_PROVIDERS = [
  { provide: APP_PIPE, useValue: buildValidationPipe() },
  { provide: RATE_LIMIT, useFactory: () => rateLimitFromEnv() },
  // Redis store when REDIS_URL is set (production / multi-replica, native TTL eviction), else the
  // in-memory store — which keeps the Docker-free unit/e2e suites and the BDD sweep dependency-free.
  {
    provide: RATE_LIMIT_STORE,
    useFactory: (clock: Clock) =>
      process.env.REDIS_URL
        ? new RedisRateLimitStore(process.env.REDIS_URL, clock)
        : new InMemoryRateLimitStore(clock),
    inject: [TOKENS.Clock],
  },
  { provide: APP_GUARD, useClass: RateLimitGuard },
  { provide: APP_GUARD, useClass: CsrfGuard },
  { provide: APP_FILTER, useClass: DomainExceptionFilter },
];

/** Default composition: in-memory persistence (Docker-free unit/e2e tests and quick dev). */
@Module({
  imports: [PersistenceModule, ...FEATURE_MODULES],
  controllers: [HealthController],
  providers: APP_PROVIDERS,
})
export class AppModule {}

/** Production composition: Prisma/Postgres persistence. Bootstrapped by main.ts. */
@Module({
  imports: [PrismaPersistenceModule, ...FEATURE_MODULES],
  controllers: [HealthController],
  providers: APP_PROVIDERS,
})
export class ProdAppModule {}
