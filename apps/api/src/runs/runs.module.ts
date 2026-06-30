import {
  type AuditLogRepository,
  type Clock,
  type FeatureRepository,
  GetRun,
  type IdGenerator,
  ListRuns,
  type MembershipRepository,
  type ProjectRepository,
  type RunRepository,
  type RunResultRepository,
  type ScenarioRepository,
  type SubscriptionRepository,
  type TestCaseRepository,
  type TestKernel,
  TriggerRun,
  type UnitOfWork,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { ProjectRunsController, RunController } from './runs.controller';

/** Wires the Test Execution use cases (slice 3) to the bound ports. */
@Module({
  controllers: [ProjectRunsController, RunController],
  providers: [
    {
      provide: TriggerRun,
      useFactory: (
        uow: UnitOfWork,
        kernel: TestKernel,
        runs: RunRepository,
        runResults: RunResultRepository,
        features: FeatureRepository,
        scenarios: ScenarioRepository,
        testCases: TestCaseRepository,
        subscriptions: SubscriptionRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) =>
        new TriggerRun({
          uow,
          kernel,
          runs,
          runResults,
          features,
          scenarios,
          testCases,
          subscriptions,
          projects,
          memberships,
          audit,
          ids,
          clock,
        }),
      inject: [
        T.UnitOfWork,
        T.Kernel,
        T.Runs,
        T.RunResults,
        T.Features,
        T.Scenarios,
        T.TestCases,
        T.Subscriptions,
        T.Projects,
        T.Memberships,
        T.Audit,
        T.Ids,
        T.Clock,
      ],
    },
    {
      provide: ListRuns,
      useFactory: (
        runs: RunRepository,
        runResults: RunResultRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
      ) => new ListRuns({ runs, runResults, projects, memberships }),
      inject: [T.Runs, T.RunResults, T.Projects, T.Memberships],
    },
    {
      provide: GetRun,
      useFactory: (
        runs: RunRepository,
        runResults: RunResultRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
      ) => new GetRun({ runs, runResults, projects, memberships }),
      inject: [T.Runs, T.RunResults, T.Projects, T.Memberships],
    },
  ],
})
export class RunsModule {}
