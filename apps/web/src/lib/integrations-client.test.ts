import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpIntegrationsClient } from './integrations-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => payload })));
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpIntegrationsClient', () => {
  it('lists with credentials, no CSRF', async () => {
    mockFetch([]);
    await httpIntegrationsClient.list('o1');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/orgs\/o1\/integrations$/);
    expect(init.method).toBeUndefined();
    expect(init.credentials).toBe('include');
  });

  it('connect PATCHes the key with action+token and the CSRF token', async () => {
    document.cookie = 'csrf=tok-9';
    mockFetch({ key: 'github', connected: true });
    await httpIntegrationsClient.connect('o1', 'github', 'ghp_secret');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/orgs\/o1\/integrations\/github$/);
    expect(init.method).toBe('PATCH');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-9');
    expect(JSON.parse(init.body!)).toEqual({ action: 'connect', token: 'ghp_secret' });
  });

  it('disconnect PATCHes with action only', async () => {
    mockFetch({ key: 'github', connected: false });
    await httpIntegrationsClient.disconnect('o1', 'github');
    const [, init] = lastCall();
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body!)).toEqual({ action: 'disconnect' });
  });

  it('importRepo POSTs the repo to the project', async () => {
    mockFetch({ imported: 2 });
    await httpIntegrationsClient.importRepo('p1', { fullName: 'acme/web-app', branch: 'main' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/repo\/import$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body!)).toEqual({ fullName: 'acme/web-app', branch: 'main' });
  });

  it('throws the RFC9457 detail on error', async () => {
    mockFetch({ detail: 'Owners and admins only.' }, false, 403);
    await expect(httpIntegrationsClient.connect('o1', 'github', 't')).rejects.toThrow(/admins only/);
  });
});
