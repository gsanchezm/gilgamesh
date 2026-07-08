/**
 * Graceful-shutdown SIGTERM handler factory (slice 29). Framework-free and side-effect-injectable so
 * the drain sequence + grace window + idempotency are unit-testable without real signals or timers.
 *
 * The sequence, on the first invocation:
 *   1. `beginDraining()` synchronously  — readiness flips to 503, ACA stops routing NEW traffic here.
 *   2. wait `graceMs`                    — in-flight requests finish; ACA's Readiness probe observes
 *                                          `not-ready` and drains this replica from rotation.
 *   3. `close()`                         — Nest `app.close()`: runs the shutdown hooks (Prisma
 *                                          `$disconnect`) and stops the HTTP server.
 *
 * A `started` guard makes a second SIGTERM during the grace window a no-op (no double-drain / close).
 */
export interface GracefulShutdownDeps {
  /** Flip the shared `ShutdownState` so `/health/ready` starts answering 503. */
  beginDraining: () => void;
  /** Close the app (typically `() => app.close()`); runs Nest shutdown hooks → Prisma disconnect. */
  close: () => Promise<void>;
  /** Grace window (ms) between draining and closing — in-flight requests finish here. */
  graceMs: number;
  /** Injectable timer (defaults to global `setTimeout`); unit tests pass a fake to fire synchronously. */
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  /** Called after a successful `close()` — typically `() => process.exit(0)`. */
  onClosed?: () => void;
  /** Called if `close()` rejects — typically logs + `process.exit(1)`. Never left unhandled. */
  onError?: (error: unknown) => void;
  /** Optional structured log sink for the drain notice. */
  log?: (message: string) => void;
}

/**
 * Build the SIGTERM handler. Returns a plain `() => void` to register with `process.on('SIGTERM', …)`.
 */
export function createShutdownHandler(deps: GracefulShutdownDeps): () => void {
  const schedule = deps.setTimeoutFn ?? setTimeout;
  let started = false;

  return () => {
    if (started) return; // idempotent: ignore a second SIGTERM while already draining/closing
    started = true;

    deps.beginDraining();
    deps.log?.(`SIGTERM received — draining, ${deps.graceMs}ms grace before close`);

    schedule(() => {
      deps
        .close()
        .then(() => deps.onClosed?.())
        .catch((error: unknown) => deps.onError?.(error));
    }, deps.graceMs);
  };
}
