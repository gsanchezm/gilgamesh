import {
  type AgentBrainPort,
  ApplyPaymentEvent,
  type BrainUsageRepository,
  type Clock,
  DeterministicKernel,
  type IdGenerator,
  InMemoryEventBus,
  type IntegrationRepository,
  type InvoiceRepository,
  type KnowledgeChunkRepository,
  KnowledgeRetriever,
  MockRepoProvider,
  type SecretVault,
  type SubscriptionRepository,
  type UnitOfWork,
} from '@gilgamesh/application';
import { Global, Module } from '@nestjs/common';
import {
  Argon2PasswordHasher,
  brainFromEnv,
  brainKeyVerifierFromEnv,
  CryptoSessionTokenGenerator,
  emailFromEnv,
  paymentsFromEnv,
  SystemClock,
  Uuid7IdGenerator,
  vaultFromEnv,
} from '../../infra';
import { TOKENS } from '../tokens';
import { PrismaService } from './prisma.service';
import {
  PrismaAgentRepository,
  PrismaAuditLogRepository,
  PrismaBrainUsageRepository,
  PrismaChatMessageRepository,
  PrismaChatSessionRepository,
  PrismaFeatureRepository,
  PrismaIntegrationRepository,
  PrismaInvoiceRepository,
  PrismaKnowledgeChunkRepository,
  PrismaKnowledgeDocumentRepository,
  PrismaMembershipRepository,
  PrismaOrgRepository,
  PrismaPasswordResetRepository,
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
    { provide: TOKENS.PasswordResets, useFactory: (db: PrismaService) => new PrismaPasswordResetRepository(db), inject: [PrismaService] },
    // Provider selection (S17, the S9-1 pattern): the S12 recording stub unless EMAIL_MODE/
    // SMTP_URL select the real nodemailer SMTP adapter — the "later swap behind the same frozen
    // §5 port" promised by owner decision S12, delivered as this one wiring change.
    { provide: TOKENS.Email, useFactory: () => emailFromEnv() },
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
    { provide: TOKENS.Invoices, useFactory: (db: PrismaService) => new PrismaInvoiceRepository(db), inject: [PrismaService] },
    { provide: TOKENS.Audit, useFactory: (db: PrismaService) => new PrismaAuditLogRepository(db), inject: [PrismaService] },
    { provide: TOKENS.UnitOfWork, useFactory: (db: PrismaService) => new PrismaUnitOfWork(db), inject: [PrismaService] },
    { provide: TOKENS.Hasher, useValue: new Argon2PasswordHasher() },
    { provide: TOKENS.Ids, useValue: new Uuid7IdGenerator() },
    { provide: TOKENS.Tokens, useValue: new CryptoSessionTokenGenerator() },
    { provide: TOKENS.Clock, useValue: new SystemClock() },
    // Provider selection (S9-1): the stub unless BRAIN_MODE/ANTHROPIC_API_KEY select the real
    // Claude adapter; the key verifier follows the same mode. The EventBus stays in-process
    // in-memory (one API replica) — a Redis pub/sub swap is wiring-only later.
    // In auto, `forOrg` resolves a connected org BYOK key per call (integrations row + vault).
    {
      provide: TOKENS.Brain,
      useFactory: (integrations: IntegrationRepository, vault: SecretVault) =>
        brainFromEnv(process.env, { integrations, vault }),
      inject: [TOKENS.Integrations, TOKENS.SecretVault],
    },
    { provide: TOKENS.BrainKeys, useFactory: () => brainKeyVerifierFromEnv() },
    { provide: TOKENS.Events, useValue: new InMemoryEventBus() },
    {
      provide: TOKENS.BrainUsage,
      useFactory: (db: PrismaService) => new PrismaBrainUsageRepository(db),
      inject: [PrismaService],
    },
    { provide: TOKENS.Kernel, useValue: new DeterministicKernel() },
    // Provider selection (S13-B, the brain pattern): the deterministic mock unless PAYMENTS_MODE/
    // STRIPE_SECRET_KEY select the real Stripe adapter. Webhook effects persist through the
    // UoW-backed ApplyPaymentEvent seam (invoice + subscription status commit together).
    {
      provide: TOKENS.Payment,
      useFactory: (
        uow: UnitOfWork,
        ids: IdGenerator,
        clock: Clock,
        invoices: InvoiceRepository,
        subscriptions: SubscriptionRepository,
      ) =>
        paymentsFromEnv(process.env, {
          events: new ApplyPaymentEvent({ uow, ids, clock }),
          invoices,
          subscriptions,
        }),
      inject: [TOKENS.UnitOfWork, TOKENS.Ids, TOKENS.Clock, TOKENS.Invoices, TOKENS.Subscriptions],
    },
    {
      provide: TOKENS.Knowledge,
      useFactory: (db: PrismaService) => new PrismaKnowledgeChunkRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TOKENS.KnowledgeDocuments,
      useFactory: (db: PrismaService) => new PrismaKnowledgeDocumentRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TOKENS.KnowledgeRetrieval,
      // S16: scoped grounding meters EMBED BrainUsage rows for the filter org.
      useFactory: (
        brain: AgentBrainPort,
        knowledge: KnowledgeChunkRepository,
        brainUsage: BrainUsageRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new KnowledgeRetriever({ brain, knowledge, meter: { brainUsage, ids, clock } }),
      inject: [TOKENS.Brain, TOKENS.Knowledge, TOKENS.BrainUsage, TOKENS.Ids, TOKENS.Clock],
    },
    {
      provide: TOKENS.ChatSessions,
      useFactory: (db: PrismaService) => new PrismaChatSessionRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TOKENS.ChatMessages,
      useFactory: (db: PrismaService) => new PrismaChatMessageRepository(db),
      inject: [PrismaService],
    },
    {
      provide: TOKENS.Integrations,
      useFactory: (db: PrismaService) => new PrismaIntegrationRepository(db),
      inject: [PrismaService],
    },
    { provide: TOKENS.RepoProvider, useValue: new MockRepoProvider() },
    // Provider selection (S20, the S15 security INVERSION): explicit VAULT_MODE=offline → the
    // in-memory stub (refused under NODE_ENV=production); AZURE_KEY_VAULT_URL → Azure Key Vault;
    // anything else REFUSES TO BOOT — a silently selected vault stub would hold live BYOK keys
    // in process memory. Every harness pins VAULT_MODE=offline.
    { provide: TOKENS.SecretVault, useFactory: () => vaultFromEnv() },
  ],
  exports: [
    PrismaService,
    TOKENS.Users,
    TOKENS.Orgs,
    TOKENS.Memberships,
    TOKENS.Sessions,
    TOKENS.PasswordResets,
    TOKENS.Email,
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
    TOKENS.Invoices,
    TOKENS.Audit,
    TOKENS.UnitOfWork,
    TOKENS.Hasher,
    TOKENS.Ids,
    TOKENS.Tokens,
    TOKENS.Clock,
    TOKENS.Brain,
    TOKENS.BrainKeys,
    TOKENS.BrainUsage,
    TOKENS.Events,
    TOKENS.Kernel,
    TOKENS.Payment,
    TOKENS.Knowledge,
    TOKENS.KnowledgeDocuments,
    TOKENS.KnowledgeRetrieval,
    TOKENS.ChatSessions,
    TOKENS.ChatMessages,
    TOKENS.Integrations,
    TOKENS.RepoProvider,
    TOKENS.SecretVault,
  ],
})
export class PrismaPersistenceModule {}
