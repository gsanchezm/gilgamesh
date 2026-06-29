import { HttpStatus, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AgentsModule } from '../../src/agents/agents.module';
import { AuthModule } from '../../src/auth/auth.module';
import { SecurityModule } from '../../src/auth/security.module';
import { DomainExceptionFilter } from '../../src/common/domain-exception.filter';
import { OrgsModule } from '../../src/orgs/orgs.module';
import { PrismaPersistenceModule } from '../../src/persistence/prisma/prisma-persistence.module';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { ProjectsModule } from '../../src/projects/projects.module';

let app: INestApplication;
let db: PrismaService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [PrismaPersistenceModule, SecurityModule, AuthModule, ProjectsModule, AgentsModule, OrgsModule],
    providers: [
      {
        provide: APP_PIPE,
        useValue: new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        }),
      },
      { provide: APP_FILTER, useClass: DomainExceptionFilter },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  db = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE orgs, users, memberships, sessions, projects, slices, agents, tool_bindings, subscriptions, audit_logs CASCADE',
  );
});

async function authedCookie(email: string): Promise<string> {
  const reg = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ firstName: 'Ishtar', lastName: 'Uruk', email, password: 'C0rrect-Horse!' });
  const sc = reg.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [String(sc)]).map((c) => String(c).split(';')[0]).join('; ');
}

describe('Persistence (Prisma · real Postgres)', () => {
  it('persists the full register → onboarding → agent room flow', async () => {
    const server = app.getHttpServer();
    const cookie = await authedCookie('ishtar@uruk.io');

    const proj = await request(server)
      .post('/projects')
      .set('Cookie', cookie)
      .send({ projectName: 'OmniPizza Web', format: 'BDD', repoProvider: 'github' });
    expect(proj.status).toBe(201);
    expect(proj.body.slug).toBe('omnipizza-web');

    const room = await request(server)
      .get(`/projects/${proj.body.projectId}/agents`)
      .set('Cookie', cookie);
    expect(room.status).toBe(200);
    expect(room.body.agents).toHaveLength(11);
    expect(room.body.kpis.awake).toBe(11);

    expect(await db.org.count()).toBe(1);
    expect(await db.user.count()).toBe(1);
    expect(await db.agent.count()).toBe(11);
    expect(await db.slice.count()).toBe(5);
    expect(await db.toolBinding.count()).toBe(11);
    expect(await db.subscription.count()).toBe(1);
    expect((await db.subscription.findFirst())?.plan).toBe('TEAM');
    expect(await db.auditLog.count()).toBeGreaterThanOrEqual(3); // auth.register + org.created + project.created
    expect((await db.user.findFirst())?.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('persists wake-all (every binding enabled)', async () => {
    const server = app.getHttpServer();
    const cookie = await authedCookie('ishtar@uruk.io');
    const proj = await request(server)
      .post('/projects')
      .set('Cookie', cookie)
      .send({ projectName: 'OmniPizza Web', format: 'BDD' });

    const res = await request(server)
      .post(`/projects/${proj.body.projectId}/agents/wake-all`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ awake: 11, total: 11 });
    expect(await db.toolBinding.count({ where: { enabled: true } })).toBe(11);
  });

  it('enforces tenant isolation across orgs (404)', async () => {
    const server = app.getHttpServer();
    const ownerCookie = await authedCookie('owner@example.com');
    const proj = await request(server)
      .post('/projects')
      .set('Cookie', ownerCookie)
      .send({ projectName: 'OmniPizza Web', format: 'BDD' });

    const intruderCookie = await authedCookie('intruder@example.com');
    const res = await request(server)
      .get(`/projects/${proj.body.projectId}/agents`)
      .set('Cookie', intruderCookie);
    expect(res.status).toBe(404);
  });
});
