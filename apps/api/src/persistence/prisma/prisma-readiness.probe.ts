import type { ReadinessProbe } from '../../health/readiness';

/**
 * The single Prisma capability the readiness probe needs — narrowed to a tagged-template raw-query
 * runner so the unit test can supply a fake without constructing a whole PrismaClient. `PrismaService`
 * (extends `PrismaClient`) satisfies this structurally.
 */
export interface RawQueryRunner {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Default DB-probe timeout (ms). MUST stay well under the ACA Readiness probe `timeoutSeconds`
 * (`infra/bicep/modules/containerApps.bicep`) so a hung/asleep DB yields a prompt 503, never a
 * hanging HTTP probe.
 */
export const DEFAULT_READINESS_TIMEOUT_MS = 2000;

/**
 * Readiness for the Prisma/Postgres wiring: a cheap, parameterless `SELECT 1` bounded by a timeout.
 * Resolves when Postgres answers; REJECTS on any query error OR when the query outruns the timeout —
 * the `HealthController` maps a rejection to 503 `{status:'not-ready'}`, so a cold-woken or
 * mid-migration DB holds traffic (ACA readiness) instead of restarting the container.
 */
export class PrismaReadinessProbe implements ReadinessProbe {
  constructor(
    private readonly db: RawQueryRunner,
    private readonly timeoutMs: number = DEFAULT_READINESS_TIMEOUT_MS,
  ) {}

  async check(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('readiness DB probe timed out')),
        this.timeoutMs,
      );
    });
    try {
      // Index-free, no table access — the cheapest possible connectivity check.
      await Promise.race([this.db.$queryRaw`SELECT 1`, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
