import { setWorldConstructor, World, type IWorldOptions } from '@cucumber/cucumber';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import type { PrismaService } from '../../src/persistence/prisma/prisma.service';

/**
 * Per-scenario world. The Nest app + Prisma client are booted once in BeforeAll
 * (see hooks.ts) and attached here in a Before hook; the DB is truncated between
 * scenarios so each starts from a clean tenant-less state.
 */
export class GilgameshWorld extends World {
  app!: INestApplication;
  db!: PrismaService;
  /** Spec base path; the API is mounted under this global prefix in the harness. */
  basePath = '/api/v1';
  /** Current cookies as "name=value; name=value" (session + csrf), or null when signed out. */
  cookie: string | null = null;
  /** The csrf token (= the `csrf` cookie value), sent as X-CSRF-Token on mutations. */
  csrf: string | null = null;
  /** Last HTTP response for the When step. */
  response: Response | null = null;
  /** Named scratch values referenced across steps (e.g. PRE, SHORT, LONG, lastPassword). */
  notes = new Map<string, unknown>();
  /** Ids captured from the most recent onboarding, used to resolve {id}/{orgId} in paths. */
  lastOrgId: string | null = null;
  lastProjectId: string | null = null;
  /** Project name -> id, so spec paths like "/projects/Foreign/agents" resolve to a real id. */
  projectsByName = new Map<string, string>();

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** Resolve a spec path: substitute {id}/{orgId}, map known project-name segments, prefix base. */
  url(path: string): string {
    const resolved = path
      .replace('{id}', this.lastProjectId ?? '{id}')
      .replace('{orgId}', this.lastOrgId ?? '{orgId}');
    const mapped = resolved
      .split('/')
      .map((seg) => this.projectsByName.get(seg) ?? seg)
      .join('/');
    return `${this.basePath}${mapped}`;
  }

  /** Capture the session + csrf cookies from a response's Set-Cookie, if present. */
  captureCookie(res: Response): void {
    const raw = res.headers['set-cookie'];
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [String(raw)];
    const pairs: string[] = [];
    for (const c of cookies) {
      const pair = c.split(';')[0];
      if (c.startsWith('__Host-gg_session')) pairs.push(pair);
      if (c.startsWith('csrf=')) {
        pairs.push(pair);
        this.csrf = pair.slice('csrf='.length);
      }
    }
    if (pairs.length) this.cookie = pairs.join('; ');
  }

  /** Apply the current session+csrf cookies and the CSRF header to a supertest request. */
  applyAuth<T extends { set(field: string, value: string): T }>(req: T): T {
    if (this.cookie) req.set('Cookie', this.cookie);
    if (this.csrf) req.set('X-CSRF-Token', this.csrf);
    return req;
  }
}

setWorldConstructor(GilgameshWorld);
