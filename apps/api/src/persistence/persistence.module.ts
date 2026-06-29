import {
  InMemoryAgentRepository,
  InMemoryAuditLogRepository,
  InMemoryMembershipRepository,
  InMemoryOrgRepository,
  InMemoryProjectRepository,
  InMemorySessionRepository,
  InMemorySliceRepository,
  InMemorySubscriptionRepository,
  InMemoryToolBindingRepository,
  InMemoryUserRepository,
} from '@gilgamesh/application';
import { Global, Module } from '@nestjs/common';
import {
  Argon2PasswordHasher,
  CryptoSessionTokenGenerator,
  SystemClock,
  Uuid7IdGenerator,
} from '../infra';
import { TOKENS } from './tokens';

/**
 * Wires the application ports to concrete adapters. Repositories are the in-memory
 * adapters for now (swapped for Prisma once the DB is available); the security infra
 * (Argon2id, UUID v7, crypto session tokens, system clock) is production-grade already.
 */
@Global()
@Module({
  providers: [
    { provide: TOKENS.Users, useValue: new InMemoryUserRepository() },
    { provide: TOKENS.Orgs, useValue: new InMemoryOrgRepository() },
    { provide: TOKENS.Memberships, useValue: new InMemoryMembershipRepository() },
    { provide: TOKENS.Sessions, useValue: new InMemorySessionRepository() },
    { provide: TOKENS.Projects, useValue: new InMemoryProjectRepository() },
    { provide: TOKENS.Slices, useValue: new InMemorySliceRepository() },
    { provide: TOKENS.Agents, useValue: new InMemoryAgentRepository() },
    { provide: TOKENS.ToolBindings, useValue: new InMemoryToolBindingRepository() },
    { provide: TOKENS.Subscriptions, useValue: new InMemorySubscriptionRepository() },
    { provide: TOKENS.Audit, useValue: new InMemoryAuditLogRepository() },
    { provide: TOKENS.Hasher, useValue: new Argon2PasswordHasher() },
    { provide: TOKENS.Ids, useValue: new Uuid7IdGenerator() },
    { provide: TOKENS.Tokens, useValue: new CryptoSessionTokenGenerator() },
    { provide: TOKENS.Clock, useValue: new SystemClock() },
  ],
  exports: [
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
export class PersistenceModule {}
