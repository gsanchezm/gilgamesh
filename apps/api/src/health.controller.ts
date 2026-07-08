import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ReadinessProbe } from './health/readiness';
import { ShutdownState } from './health/shutdown-state';
import { TOKENS } from './persistence/tokens';

@Controller('health')
export class HealthController {
  // Constructor-time dependencies ONLY: storing the probe/shutdown references touches no database.
  // The liveness handler never calls either — see the invariant note on `check()`.
  constructor(
    @Inject(TOKENS.Readiness) private readonly readiness: ReadinessProbe,
    private readonly shutdown: ShutdownState,
  ) {}

  /**
   * LIVENESS — "is this process alive?". MUST NOT depend on the DB: a 200 means the process is
   * running, nothing more. If liveness failed on DB-down, ACA would KILL and restart the container
   * (crash loop) instead of merely holding traffic — so this stays a constant, DB-free 200.
   * Unchanged since day 1 (`/api/v1/health` under the prod global prefix).
   */
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * READINESS — "is it safe to route traffic here?". Runs a cheap, bounded DB probe (`SELECT 1`):
   * 200 `{status:'ready'}` when the store answers, 503 `{status:'not-ready'}` when it does not — so
   * ACA holds traffic off a replica whose Postgres isn't reachable yet (cold wake / mid-migration)
   * WITHOUT killing the container.
   *
   * Graceful shutdown (slice 29): once SIGTERM has begun draining this replica we are NOT ready even
   * if the DB is perfectly healthy — so we short-circuit to 503 BEFORE touching the probe. ACA's
   * Readiness probe then stops routing new traffic here while the process finishes in-flight work.
   *
   * We set the 503 status directly (via `@Res({ passthrough: true })`) rather than throwing a
   * `ServiceUnavailableException`, because the global `DomainExceptionFilter` (`@Catch()`) would
   * rewrite any HttpException into RFC9457 problem+json — not the `{status:'not-ready'}` body this
   * contract promises. Any probe failure (query error OR timeout) is caught → a clean 503, never a
   * 500 and never an unhandled throw.
   */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{ status: string }> {
    if (this.shutdown.draining) {
      res.status(503);
      return { status: 'not-ready' };
    }
    try {
      await this.readiness.check();
      return { status: 'ready' };
    } catch {
      res.status(503);
      return { status: 'not-ready' };
    }
  }
}
