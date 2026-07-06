import { AfterAll, Before, BeforeAll, setDefaultTimeout } from '@cucumber/cucumber';
import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AgentsModule } from '../../src/agents/agents.module';
import { APP_PROVIDERS } from '../../src/app.module';
import { configureBodyParser } from '../../src/common/body-parser';
import { AuthModule } from '../../src/auth/auth.module';
import { SecurityModule } from '../../src/auth/security.module';
import { OrgsModule } from '../../src/orgs/orgs.module';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { BillingModule } from '../../src/billing/billing.module';
import { BrainModule } from '../../src/brain/brain.module';
import { ChatModule } from '../../src/chat/chat.module';
import { IntegrationsModule } from '../../src/integrations/integrations.module';
import { KnowledgeModule } from '../../src/knowledge/knowledge.module';
import { ProjectsModule } from '../../src/projects/projects.module';
import { RunsModule } from '../../src/runs/runs.module';
import { TestLabModule } from '../../src/testlab/testlab.module';
import type { GilgameshWorld } from './world';

// Booting Nest + connecting Prisma can take a moment on the first scenario.
setDefaultTimeout(30_000);

let app: INestApplication;
let db: PrismaService;

// Same wiring as the integration suite: Prisma persistence + the real validation
// pipe (422 on bad input) + the domain->Problem exception filter, mounted under /api/v1.
BeforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      PrismaPersistenceModule,
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
    ],
    providers: APP_PROVIDERS,
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  // Same body-parser wiring as main.ts — the webhook raw-body branch is part of the contract
  // (signature verification runs over the raw bytes, spec 13 AC-PAY-05).
  configureBodyParser(app as NestExpressApplication);
  app.setGlobalPrefix('api/v1');
  await app.init();
  db = app.get(PrismaService);
});

AfterAll(async () => {
  await app?.close();
});

// Fresh per scenario: attach the shared app/db and reset cookie + scratch state,
// then truncate every slice-1 table so no tenant leaks across scenarios.
Before(async function (this: GilgameshWorld) {
  this.app = app;
  this.db = db;
  this.cookie = null;
  this.csrf = null;
  this.response = null;
  this.notes = new Map();
  this.lastOrgId = null;
  this.lastProjectId = null;
  this.projectsByName = new Map();
  await db.$executeRawUnsafe(
    'TRUNCATE orgs, users, memberships, sessions, password_resets, projects, slices, features, scenarios, test_cases, runs, run_results, agents, tool_bindings, subscriptions, invoices, audit_logs, knowledge_chunks, integrations, chat_sessions, chat_messages, brain_usage CASCADE',
  );
});
