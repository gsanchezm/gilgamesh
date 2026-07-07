/**
 * Readiness probe port (slice 27). Readiness is an infra / deployment concern, not product
 * vocabulary, so it lives in `apps/api` rather than `@gilgamesh/application`.
 *
 * An implementation answers "is it safe to route traffic to this replica?" by verifying the
 * backing store is reachable. `check()` MUST be cheap and bounded: it RESOLVES when ready and
 * REJECTS (never hangs) when the store is unreachable or slow — the readiness controller maps a
 * rejection to a 503 so Azure Container Apps holds traffic without restarting the container.
 *
 * NOTE: this is deliberately NOT wired into liveness. Liveness must have no DB dependency (see
 * `HealthController`), or a DB-down would make ACA crash-loop the container instead of just
 * pausing traffic to it.
 */
export interface ReadinessProbe {
  check(): Promise<void>;
}
