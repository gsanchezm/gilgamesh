import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { SecurityModule } from './auth/security.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { buildValidationPipe } from './common/validation.pipe';
import { HealthController } from './health.controller';
import { OrgsModule } from './orgs/orgs.module';
import { PersistenceModule } from './persistence/persistence.module';
import { PrismaPersistenceModule } from './persistence/prisma/prisma-persistence.module';
import { ProjectsModule } from './projects/projects.module';

// The two compositions differ ONLY in the persistence wiring; controllers, guards, the
// validation pipe and the domain->Problem filter are identical across both.
const FEATURE_MODULES = [SecurityModule, AuthModule, ProjectsModule, AgentsModule, OrgsModule];
const APP_PROVIDERS = [
  { provide: APP_PIPE, useValue: buildValidationPipe() },
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
