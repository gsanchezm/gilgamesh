import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpAuthClient } from './auth-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string> };

function mockFetch(impl: () => unknown) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpAuthClient.me', () => {
  it('returns the active org and sends credentials to /auth/me (200)', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ user: {}, memberships: [], activeOrgId: 'org-5' }),
    }));
    expect(await httpAuthClient.me()).toEqual({ activeOrgId: 'org-5' });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, { credentials?: string }];
    expect(String(url)).toMatch(/\/auth\/me$/);
    expect(init.credentials).toBe('include');
  });

  it('returns null when unauthenticated (401)', async () => {
    mockFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await httpAuthClient.me()).toBeNull();
  });
});

describe('httpAuthClient.register', () => {
  it('POSTs to /auth/register with credentials and NO CSRF token, returning the userId', async () => {
    document.cookie = 'csrf=tok-should-be-ignored';
    mockFetch(async () => ({ ok: true, status: 201, json: async () => ({ userId: 'u-9' }) }));

    const result = await httpAuthClient.register({
      firstName: 'Gabriel',
      lastName: 'Sánchez',
      email: 'gabriel@acme.com',
      password: 'correct horse battery',
    });

    expect(result).toEqual({ userId: 'u-9' });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, FetchInit];
    expect(String(url)).toMatch(/\/auth\/register$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    // Register establishes the session — there is no token yet, so no CSRF header is sent.
    expect(init.headers?.['X-CSRF-Token']).toBeUndefined();
  });

  it('throws the server detail when registration fails', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: 'An account with this email already exists.' }),
    }));

    await expect(
      httpAuthClient.register({
        firstName: 'Gabriel',
        lastName: 'Sánchez',
        email: 'dup@acme.com',
        password: 'correct horse battery',
      }),
    ).rejects.toThrow('already exists');
  });
});

describe('httpAuthClient.logout', () => {
  it('POSTs with the CSRF token + credentials', async () => {
    document.cookie = 'csrf=tok-7';
    mockFetch(async () => ({ ok: true, status: 204, json: async () => ({}) }));

    await httpAuthClient.logout();

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as FetchInit;
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-7');
  });
});
