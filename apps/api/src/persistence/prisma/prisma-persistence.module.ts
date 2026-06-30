import { DeterministicBrain, DeterministicKernel } from '@gilgamesh/application';
import { Global, Module } from '@nestjs/common';
import {
  Argon2PasswordHasher,
  CryptoSessionTokenGenerator,
  SystemClock,
  Uuid7IdGenerator,
} from '../../infra';
import { TOKENS } from '../tokens';
import { PrismaService } from './prisma.service';
import {
  PrismaAgentRepository,
  PrismaAuditLogRepository,
  PrismaFeatureRepository,
  PrismaMembershipRepository,
  PrismaOrgRepository,
  PrismaProjectRepository,
  PrismaRunRepository,
  PrismaRunResultRepository,
  PrismaScenarioRepository,
  PrismaSessionRepository,
  PrismaSliceRepository,
  PrismaSubscriptionRepository,
  PrismaTestCaseRepository,
  PrismaToolBindingRepository,
  PrismaUserRepository,
} from './prisma-repositories';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

/** Production persistence: Prisma-backed repositories (real Postgres) + security infra. */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: TOKENS.Users, useFactory: (db: PrismaService) => new PrismaUserRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Orgs, useFactory: (db: PrismaService) => new PrismaOrgRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Memberships, useFactory: (db: PrismaService) => new PrismaMembershipRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Sessions, useFactory: (db: PrismaService) => new PrismaSessionRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Projects, useFactory: (db: PrismaService) => new PrismaProjectRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Slices, useFactory: (db: PrismaService) => new PrismaSliceRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Features, useFactory: (db: PrismaService) => new PrismaFeatureRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Scenarios, useFactory: (db: PrismaService) => new PrismaScenarioRepository(db), inject: [PrismaService] },
    { provide: TOKENS.TestCases, useFactory: (db: PrismaService) => new PrismaTestCaseRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Runs, useFactory: (db: PrismaService) => new PrismaRunRepository(db), inject: [PrismaService] },
    { provide: TOKENS.RunResults, useFactory: (db: PrismaService) => new PrismaRunResultRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Agents, useFactory: (db: PrismaService) => new PrismaAgentRepository(db), inject: [PrismaService] },
    { provide: TOKENS.ToolBindings, useFactory: (db: PrismaService) => new PrismaToolBindingRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Subscriptions, useFactory: (db: PrismaService) => new PrismaSubscriptionRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Audit, useFactory: (db: PrismaService) => new PrismaAuditLogRepository(db), inject: [PrismaService] },
    { provide: TOKENS.UnitOfWork, useFactory: (db: PrismaService) => new PrismaUnitOfWork(db), inject: [PrismaService] },
    { provide: TOKENS.Hasher, useValue: new Argon2PasswordHasher() },
    { provide: TOKENS.Ids, useValue: new Uuid7IdGenerator() },
    { provide: TOKENS.Tokens, useValue: new CryptoSessionTokenGenerator() },
    { provide: TOKENS.Clock, useValue: new SystemClock() },
    { provide: TOKENS.Brain, useValue: new DeterministicBrain() },
    { provide: TOKENS.Kernel, useValue: new DeterministicKernel() },
  ],
  exports: [
    PrismaService,
    TOKENS.Users,
    TOKENS.Orgs,
    TOKENS.Memberships,
    TOKENS.Sessions,
    TOKENS.Projects,
    TOKENS.Slices,
    TOKENS.Features,
    TOKENS.Scenarios,
    TOKENS.TestCases,
    TOKENS.Runs,
    TOKENS.RunResults,
    TOKENS.Agents,
    TOKENS.ToolBindings,
    TOKENS.Subscriptions,
    TOKENS.Audit,
    TOKENS.UnitOfWork,
    TOKENS.Hasher,
    TOKENS.Ids,
    TOKENS.Tokens,
    TOKENS.Clock,
    TOKENS.Brain,
    TOKENS.Kernel,
  ],
})
export class PrismaPersistenceModule {}
