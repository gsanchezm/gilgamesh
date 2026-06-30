import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpRunsClient } from './runs-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => payload })));
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

const aRun = {
  id: 'r1', projectId: 'p1', status: 'DONE', targetKind: 'FEATURE', targetId: 'f1', runLabel: null,
  passed: 1, failed: 0, skipped: 0, total: 1, ratePct: 100, durationMs: 5, createdAt: '2026-06-30T00:00:00.000Z',
  results: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpRunsClient', () => {
  it('triggerRun POSTs the target with the CSRF token + JSON body', async () => {
    document.cookie = 'csrf=tok-7';
    mockFetch(aRun, true, 201);
    await httpRunsClient.triggerRun('p1', { targetKind: 'FEATURE', targetId: 'f1' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/runs$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-7');
    expect(JSON.parse(init.body!)).toEqual({ targetKind: 'FEATURE', targetId: 'f1' });
  });

  it('listRuns GETs the project runs with credentials (no CSRF)', async () => {
    mockFetch([aRun]);
    await httpRunsClient.listRuns('p1');
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/projects\/p1\/runs$/);
    expect(init.credentials).toBe('include');
    expect(init.method).toBeUndefined();
  });

  it('getRun GETs the run by id', async () => {
    mockFetch(aRun);
    await httpRunsClient.getRun('r1');
    const [url] = lastCall();
    expect(String(url)).toMatch(/\/runs\/r1$/);
  });

  it('throws the RFC9457 problem detail on error', async () => {
    mockFetch({ detail: 'Feature not found.' }, false, 404);
    await expect(httpRunsClient.triggerRun('p1', { targetKind: 'FEATURE', targetId: 'x' })).rejects.toThrow(
      /not found/,
    );
  });
});
