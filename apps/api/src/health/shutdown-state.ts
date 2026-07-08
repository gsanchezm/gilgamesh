import { Injectable } from '@nestjs/common';

/**
 * Graceful-shutdown state seam (slice 29). A tiny process-scoped flag that the readiness path
 * consults and the SIGTERM handler flips, so a replica being retired stops advertising itself as
 * ready (ACA's Readiness probe then holds new traffic) BEFORE it stops serving.
 *
 * App-level, not persistence-level: it is bound ONCE in `APP_PROVIDERS` (`app.module.ts`), shared by
 * both the in-memory and Prisma compositions. As a DI singleton, the instance the `HealthController`
 * injects is the SAME one `main.ts` retrieves (`app.get(ShutdownState)`) and flips on SIGTERM.
 *
 * `draining` is monotonic — once shutdown begins it never un-drains; a replica does not come back to
 * ready and resume taking traffic mid-teardown.
 */
@Injectable()
export class ShutdownState {
  private _draining = false;

  /** True once SIGTERM has begun draining this replica — readiness answers `not-ready` from here on. */
  get draining(): boolean {
    return this._draining;
  }

  /** Begin draining. Idempotent (already-true stays true). Called by the SIGTERM handler in main.ts. */
  beginDraining(): void {
    this._draining = true;
  }
}
