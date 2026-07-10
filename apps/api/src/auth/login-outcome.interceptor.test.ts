import { ApplicationError, type Clock } from '@gilgamesh/application';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { lockoutKeyForIp } from './client-ip';
import { LoginOutcomeInterceptor } from './login-outcome.interceptor';
import type { LoginAttemptStore } from './login-attempt-store';

const clock: Clock = { now: () => new Date(1_000) };

function makeStore(): LoginAttemptStore & {
  recordFailure: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  return {
    recordFailure: vi.fn(async () => ({ failures: 1, lockedUntil: null })),
    clear: vi.fn(async () => undefined),
    getState: vi.fn(async () => ({ failures: 0, lockedUntil: null })),
  };
}

function ctx(path: string, method = 'POST', ip = '9.9.9.9'): ExecutionContext {
  const req = { path, method, ip, socket: {} };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const okHandler: CallHandler = { handle: () => of({ ok: true }) };
const errHandler = (err: unknown): CallHandler => ({ handle: () => throwError(() => err) });

describe('LoginOutcomeInterceptor', () => {
  it('clears the counter on a successful login', async () => {
    const store = makeStore();
    const interceptor = new LoginOutcomeInterceptor(store, clock);
    await lastValueFrom(interceptor.intercept(ctx('/auth/login'), okHandler));
    expect(store.clear).toHaveBeenCalledWith(lockoutKeyForIp('9.9.9.9'));
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failure on INVALID_CREDENTIALS and still propagates the error', async () => {
    const store = makeStore();
    const interceptor = new LoginOutcomeInterceptor(store, clock);
    const err = new ApplicationError('INVALID_CREDENTIALS', 'nope');
    await expect(
      lastValueFrom(interceptor.intercept(ctx('/auth/login'), errHandler(err))),
    ).rejects.toBe(err);
    expect(store.recordFailure).toHaveBeenCalledWith(lockoutKeyForIp('9.9.9.9'), 1_000);
  });

  it('does not record a non-credential error on the login route', async () => {
    const store = makeStore();
    const interceptor = new LoginOutcomeInterceptor(store, clock);
    const err = new ApplicationError('VALIDATION', 'bad dto'); // not a login failure code
    await expect(
      lastValueFrom(interceptor.intercept(ctx('/auth/login'), errHandler(err))),
    ).rejects.toBe(err);
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it('records an invalid reset token (VALIDATION) on the reset-password route', async () => {
    const store = makeStore();
    const interceptor = new LoginOutcomeInterceptor(store, clock);
    const err = new ApplicationError('VALIDATION', 'invalid token');
    await expect(
      lastValueFrom(interceptor.intercept(ctx('/auth/reset-password'), errHandler(err))),
    ).rejects.toBe(err);
    expect(store.recordFailure).toHaveBeenCalledOnce();
  });

  it('is a no-op for non-credential routes', async () => {
    const store = makeStore();
    const interceptor = new LoginOutcomeInterceptor(store, clock);
    await lastValueFrom(interceptor.intercept(ctx('/auth/register'), okHandler));
    expect(store.clear).not.toHaveBeenCalled();
    expect(store.recordFailure).not.toHaveBeenCalled();
  });
});
