import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpTestLabClient } from './testlab-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => payload })));
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpTestLabClient', () => {
  it('listSlices GETs the project slices with credentials (no CSRF on reads)', async () => {
    mockFetch([{ id: 's1', key: 'k', name: 'K', order: 0 }]);
    await httpTestLabClient.listSlices('p1');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/slices$/);
    expect(init.credentials).toBe('include');
    expect(init.method).toBeUndefined();
  });

  it('createSlice POSTs with the CSRF token + JSON body', async () => {
    document.cookie = 'csrf=tok-9';
    mockFetch({ id: 's2', key: 'regression', name: 'Regression', order: 1 });
    await httpTestLabClient.createSlice('p1', { key: 'regression', name: 'Regression' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/slices$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-9');
    expect(init.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body!)).toEqual({ key: 'regression', name: 'Regression' });
  });

  it('createFeature POSTs to the features path with CSRF', async () => {
    document.cookie = 'csrf=tok-1';
    mockFetch({ id: 'f1', name: 'F', path: 'f.feature', sliceId: null, content: '', scenarios: [] });
    await httpTestLabClient.createFeature('p1', { path: 'f.feature', content: 'Feature: F' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/features$/);
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-1');
  });

  it('generate POSTs to the generate path with CSRF', async () => {
    document.cookie = 'csrf=tok-2';
    mockFetch({ features: [], testCases: [] });
    await httpTestLabClient.generate('p1', { prompt: 'x' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/test-cases\/generate$/);
    expect(init.method).toBe('POST');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-2');
  });

  it('throws the RFC9457 problem detail on error', async () => {
    mockFetch({ detail: 'A slice with key "k" already exists.' }, false, 409);
    await expect(httpTestLabClient.createSlice('p1', { key: 'k', name: 'K' })).rejects.toThrow(/already exists/);
  });
});
