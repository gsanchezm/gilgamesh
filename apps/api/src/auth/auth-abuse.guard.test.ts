import type { Clock } from '@gilgamesh/application';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { IpLockoutConfig } from '../config';
import { AuthAbuseGuard } from './auth-abuse.guard';
import type { LoginAttemptState, LoginAttemptStore } from './login-attempt-store';
import type { RateLimitStore } from './rate-limit-store';

const NOW = 1_000_000;
const clock: Clock = { now: () => new Date(NOW) };
const cfg: IpLockoutConfig = {
  ipLimit: 5,
  ipWindowMs: 60_000,
  threshold: 3,
  baseMs: 60_000,
  maxMs: 900_000,
};

function ctx(path: string, method = 'POST', ip = '1.2.3.4') {
  const req = { path, method, ip, socket: {}, body: {} };
  const res = { setHeader: vi.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { context, res };
}

const notLocked: LoginAttemptState = { failures: 0, lockedUntil: null };
const okHit = { count: 1, resetAt: NOW + 60_000 };

function guard(
  attempts: Partial<LoginAttemptStore>,
  store: Partial<RateLimitStore>,
): AuthAbuseGuard {
  return new AuthAbuseGuard(
    { hit: async () => okHit, ...store } as RateLimitStore,
    { getState: async () => notLocked, recordFailure: vi.fn(), clear: vi.fn(), ...attempts } as LoginAttemptStore,
    cfg,
    clock,
  );
}

describe('AuthAbuseGuard', () => {
  it('ignores non-abuse routes without touching the stores', async () => {
    const hit = vi.fn();
    const getState = vi.fn();
    const g = guard({ getState }, { hit });
    expect(await g.canActivate(ctx('/auth/me', 'GET').context)).toBe(true);
    expect(hit).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
  });

  it('blocks a locked IP with 429 + Retry-After (A2)', async () => {
    const g = guard({ getState: async () => ({ failures: 3, lockedUntil: NOW + 5_000 }) }, {});
    const { context, res } = ctx('/auth/login');
    await expect(g.canActivate(context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('failed attempts'),
    });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
  });

  it('allows a login when the IP is not locked and under the ceiling', async () => {
    const g = guard({}, {});
    expect(await g.canActivate(ctx('/auth/login').context)).toBe(true);
  });

  it('blocks once the per-IP ceiling is exceeded (A1)', async () => {
    const g = guard({}, { hit: async () => ({ count: 6, resetAt: NOW + 30_000 }) });
    const { context, res } = ctx('/auth/register');
    await expect(g.canActivate(context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('network'),
    });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
  });

  it('does not run the lockout pre-check on non-credential routes (register)', async () => {
    const getState = vi.fn(async () => notLocked);
    const g = guard({ getState }, {});
    await g.canActivate(ctx('/auth/register').context);
    expect(getState).not.toHaveBeenCalled();
  });

  it('fails open when the lockout store throws', async () => {
    const g = guard(
      {
        getState: async () => {
          throw new Error('redis down');
        },
      },
      {},
    );
    expect(await g.canActivate(ctx('/auth/login').context)).toBe(true);
  });

  it('fails open when the ceiling store throws', async () => {
    const g = guard(
      {},
      {
        hit: async () => {
          throw new Error('redis down');
        },
      },
    );
    expect(await g.canActivate(ctx('/auth/login').context)).toBe(true);
  });
});
