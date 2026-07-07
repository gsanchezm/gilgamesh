import type { ReadinessProbe } from './readiness';

/**
 * Readiness for the in-memory persistence wiring (Docker-free tests + quick dev): the store is
 * in-process, so there is nothing external to reach — always ready. Keeps the Docker-free e2e/BDD
 * suites green while the Prisma wiring gets the real `SELECT 1` probe.
 */
export class AlwaysReadyProbe implements ReadinessProbe {
  check(): Promise<void> {
    // No external dependency to probe.
    return Promise.resolve();
  }
}
