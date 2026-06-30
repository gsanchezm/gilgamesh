import type { Repositories, UnitOfWork } from '@gilgamesh/application';
import { Prisma } from '@prisma/client';
import {
  PrismaAgentRepository,
  PrismaAuditLogRepository,
  PrismaFeatureRepository,
  PrismaMembershipRepository,
  PrismaOrgRepository,
  PrismaProjectRepository,
  PrismaScenarioRepository,
  PrismaSessionRepository,
  PrismaSliceRepository,
  PrismaSubscriptionRepository,
  PrismaTestCaseRepository,
  PrismaToolBindingRepository,
  PrismaUserRepository,
} from './prisma-repositories';
import type { PrismaService } from './prisma.service';

/** Builds the repository bundle bound to a single Prisma transaction client. */
export function makePrismaRepos(client: Prisma.TransactionClient): Repositories {
  return {
    users: new PrismaUserRepository(client),
    orgs: new PrismaOrgRepository(client),
    memberships: new PrismaMembershipRepository(client),
    sessions: new PrismaSessionRepository(client),
    projects: new PrismaProjectRepository(client),
    slices: new PrismaSliceRepository(client),
    features: new PrismaFeatureRepository(client),
    scenarios: new PrismaScenarioRepository(client),
    testCases: new PrismaTestCaseRepository(client),
    agents: new PrismaAgentRepository(client),
    toolBindings: new PrismaToolBindingRepository(client),
    subscriptions: new PrismaSubscriptionRepository(client),
    audit: new PrismaAuditLogRepository(client),
  };
}

/**
 * UnitOfWork backed by an interactive Prisma transaction: every repository write performed
 * inside `work` commits together, or rolls back entirely if `work` throws.
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly db: PrismaService) {}
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.$transaction((tx) => work(makePrismaRepos(tx)));
  }
}
