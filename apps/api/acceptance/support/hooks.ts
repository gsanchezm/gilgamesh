import { AfterAll, Before, BeforeAll, setDefaultTimeout } from '@cucumber/cucumber';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentsModule } from '../../src/agents/agents.module';
import { APP_PROVIDERS } from '../../src/app.module';
import { AuthModule } from '../../src/auth/auth.module';
import { SecurityModule } from '../../src/auth/security.module';
import { OrgsModule } from '../../src/orgs/orgs.module';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { ProjectsModule } from '../../src/projects/projects.module';
import type { GilgameshWorld } from './world';

// Booting Nest + connecting Prisma can take a moment on the first scenario.
setDefaultTimeout(30_000);

let app: INestApplication;
let db: PrismaService;

// Same wiring as the integration suite: Prisma persistence + the real validation
// pipe (422 on bad input) + the domain->Problem exception filter, mounted under /api/v1.
BeforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaPersistenceModule, SecurityModule, AuthModule, ProjectsModule, AgentsModule, OrgsModule],
    providers: APP_PROVIDERS,
  }).compile();
  app = moduleRef.createNestApplication();
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
    'TRUNCATE orgs, users, memberships, sessions, projects, slices, agents, tool_bindings, subscriptions, audit_logs CASCADE',
  );
});
