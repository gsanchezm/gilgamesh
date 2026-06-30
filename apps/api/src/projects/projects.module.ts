import {
  type Clock,
  CompleteOnboarding,
  type IdGenerator,
  type UnitOfWork,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { ProjectsController } from './projects.controller';

@Module({
  controllers: [ProjectsController],
  providers: [
    {
      provide: CompleteOnboarding,
      useFactory: (uow: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new CompleteOnboarding({ uow, ids, clock }),
      inject: [TOKENS.UnitOfWork, TOKENS.Ids, TOKENS.Clock],
    },
  ],
})
export class ProjectsModule {}
