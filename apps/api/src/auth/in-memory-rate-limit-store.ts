import type { Clock } from '@gilgamesh/application';
import { Inject, Injectable } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import type { RateLimitHit, RateLimitStore } from './rate-limit-store';

/**
 * Process-local fixed-window store backed by a Map. Suitable for a single instance
 * (Docker-free tests, quick dev). Multi-replica deployments use the Redis adapter instead.
 * Expired windows are reset lazily on the next hit for the same key.
 */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(TOKENS.Clock) private readonly clock: Clock) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = this.clock.now().getTime();
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }
}
