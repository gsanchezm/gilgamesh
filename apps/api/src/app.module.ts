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
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [PersistenceModule, SecurityModule, AuthModule, ProjectsModule, AgentsModule, OrgsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useValue: buildValidationPipe() },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
