import type { Clock } from '@gilgamesh/application';
import { Inject, Injectable } from '@nestjs/common';
import { IP_LOCKOUT } from './abuse-tokens';
import { lockedUntilFor } from './backoff';
import type { LoginAttemptState, LoginAttemptStore } from './login-attempt-store';
import type { IpLockoutConfig } from '../config';
import { TOKENS } from '../persistence/tokens';

/**
 * Process-local failure-lockout store backed by a Map (Docker-free tests, single instance). The
 * retention window rolls forward by `maxMs` on each failure, so an in-progress stuffing run keeps
 * its escalating counter alive while an abandoned one lazily resets on the next read past expiry.
 * Multi-replica deployments use the Redis adapter instead.
 */
@Injectable()
export class InMemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly records = new Map<
    string,
    { failures: number; lockedUntil: number | null; expiresAt: number }
  >();

  constructor(
    @Inject(TOKENS.Clock) private readonly clock: Clock,
    @Inject(IP_LOCKOUT) private readonly cfg: IpLockoutConfig,
  ) {}

  async recordFailure(key: string, now: number): Promise<LoginAttemptState> {
    let rec = this.records.get(key);
    if (!rec || now >= rec.expiresAt) rec = { failures: 0, lockedUntil: null, expiresAt: 0 };
    rec.failures += 1;
    rec.lockedUntil = lockedUntilFor(rec.failures, this.cfg, now);
    rec.expiresAt = now + this.cfg.maxMs; // rolling retention: survives across lock cycles
    this.records.set(key, rec);
    return { failures: rec.failures, lockedUntil: rec.lockedUntil };
  }

  async clear(key: string): Promise<void> {
    this.records.delete(key);
  }

  async getState(key: string): Promise<LoginAttemptState> {
    const now = this.clock.now().getTime();
    const rec = this.records.get(key);
    if (!rec || now >= rec.expiresAt) return { failures: 0, lockedUntil: null };
    return { failures: rec.failures, lockedUntil: rec.lockedUntil };
  }
}
