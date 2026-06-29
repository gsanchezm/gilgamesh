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
  PrismaMembershipRepository,
  PrismaOrgRepository,
  PrismaProjectRepository,
  PrismaSessionRepository,
  PrismaSliceRepository,
  PrismaSubscriptionRepository,
  PrismaToolBindingRepository,
  PrismaUserRepository,
} from './prisma-repositories';

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
    { provide: TOKENS.Agents, useFactory: (db: PrismaService) => new PrismaAgentRepository(db), inject: [PrismaService] },
    { provide: TOKENS.ToolBindings, useFactory: (db: PrismaService) => new PrismaToolBindingRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Subscriptions, useFactory: (db: PrismaService) => new PrismaSubscriptionRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Audit, useFactory: (db: PrismaService) => new PrismaAuditLogRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Hasher, useValue: new Argon2PasswordHasher() },
    { provide: TOKENS.Ids, useValue: new Uuid7IdGenerator() },
    { provide: TOKENS.Tokens, useValue: new CryptoSessionTokenGenerator() },
    { provide: TOKENS.Clock, useValue: new SystemClock() },
  ],
  exports: [
    PrismaService,
    TOKENS.Users,
    TOKENS.Orgs,
    TOKENS.Memberships,
    TOKENS.Sessions,
    TOKENS.Projects,
    TOKENS.Slices,
    TOKENS.Agents,
    TOKENS.ToolBindings,
    TOKENS.Subscriptions,
    TOKENS.Audit,
    TOKENS.Hasher,
    TOKENS.Ids,
    TOKENS.Tokens,
    TOKENS.Clock,
  ],
})
export class PrismaPersistenceModule {}
