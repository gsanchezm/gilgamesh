import type { Clock } from '@gilgamesh/application';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RateLimitStore } from './rate-limit-store';
import { RateLimitGuard } from './rate-limit.guard';

const clock: Clock = { now: () => new Date(1_000_000) };
const opts = { limit: 3, windowMs: 60_000 };

function ctx(body: Record<string, unknown>, path = '/auth/login'): ExecutionContext {
  const req = { path, ip: '1.2.3.4', socket: {}, body };
  const res = { setHeader: vi.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  it('fails open (allows the request) when the store throws', async () => {
    const store: RateLimitStore = {
      hit: async () => {
        throw new Error('redis down');
      },
    };
    const guard = new RateLimitGuard(opts, store, clock);
    await expect(guard.canActivate(ctx({ email: 'a@b.com' }))).resolves.toBe(true);
  });

  it('throttles once the count exceeds the limit', async () => {
    let n = 0;
    const store: RateLimitStore = { hit: async () => ({ count: ++n, resetAt: 1_060_000 }) };
    const guard = new RateLimitGuard(opts, store, clock);
    const c = ctx({ email: 'a@b.com' });
    for (let i = 0; i < 3; i++) expect(await guard.canActivate(c)).toBe(true);
    await expect(guard.canActivate(c)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not touch the store for non-limited paths', async () => {
    const store: RateLimitStore = { hit: vi.fn() };
    const guard = new RateLimitGuard(opts, store, clock);
    expect(await guard.canActivate(ctx({}, '/auth/me'))).toBe(true);
    expect(store.hit).not.toHaveBeenCalled();
  });
});
