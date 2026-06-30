import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpKnowledgeClient } from './knowledge-client';

type FetchInit = { method?: string; credentials?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => payload })));
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpKnowledgeClient', () => {
  it('GETs /knowledge/search with url-encoded query + k, with credentials and no CSRF', async () => {
    mockFetch({ results: [], total: 0 });
    await httpKnowledgeClient.search('boundary value & edges', 5);
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/knowledge\/search\?q=boundary\+value\+%26\+edges&k=5$/);
    expect(init.credentials).toBe('include');
    expect(init.method).toBeUndefined();
  });

  it('omits k when not provided', async () => {
    mockFetch({ results: [], total: 0 });
    await httpKnowledgeClient.search('example');
    const [url] = lastCall();
    expect(String(url)).not.toMatch(/k=/);
  });

  it('throws the RFC9457 problem detail on error', async () => {
    mockFetch({ detail: 'A query is required.' }, false, 422);
    await expect(httpKnowledgeClient.search('')).rejects.toThrow(/query is required/);
  });
});
