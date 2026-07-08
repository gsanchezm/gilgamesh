import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeConnectivity } from './connection-status';
import { getJson, sendJson } from './http';

/**
 * The HTTP layer's connectivity reporting (slice 32). A request that *reaches the server* — any HTTP
 * status, including a 4xx/5xx error response — reports `online` (connectivity is fine, the error is an
 * ordinary API error handled per-screen). Only a transport/timeout failure (no response at all) reports
 * `offline`. This is what discriminates a "connection lost" problem from a normal API error.
 */
function record() {
  const events: string[] = [];
  const unsubscribe = subscribeConnectivity((e) => events.push(e));
  return { events, unsubscribe };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http.ts connectivity reports', () => {
  it('reports OFFLINE when a GET fails with a network error (AC-CONN-01)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const { events, unsubscribe } = record();
    await getJson('/x', 'fallback', { retries: 0, sleep: async () => {} }).catch(() => {});
    unsubscribe();
    expect(events).toEqual(['offline']);
  });

  it('reports OFFLINE when a GET times out (AC-CONN-01)', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { events, unsubscribe } = record();
    await getJson('/slow', 'fallback', { timeoutMs: 5, sleep: async () => {} }).catch(() => {});
    unsubscribe();
    expect(events).toEqual(['offline']);
  });

  it('reports ONLINE (not offline) on a 404 — an ordinary API error is not a connection problem (AC-CONN-03)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ detail: 'nope' }) })),
    );
    const { events, unsubscribe } = record();
    await getJson('/missing', 'fallback').catch(() => {});
    unsubscribe();
    expect(events).toEqual(['online']);
    expect(events).not.toContain('offline');
  });

  it('reports ONLINE (not offline) on a 500 — a reached-server error is not a connection problem (AC-CONN-03)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) })),
    );
    const { events, unsubscribe } = record();
    await getJson('/err', 'fallback').catch(() => {});
    unsubscribe();
    expect(events).toEqual(['online']);
  });

  it('reports ONLINE on a successful GET (connectivity restored → AC-CONN-02)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ v: 1 }) })));
    const { events, unsubscribe } = record();
    await getJson('/ok', 'fallback');
    unsubscribe();
    expect(events).toEqual(['online']);
  });

  it('reports OFFLINE when a mutation (POST) fails with a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const { events, unsubscribe } = record();
    await sendJson('POST', '/p/runs', { id: 'x' }, 'fallback').catch(() => {});
    unsubscribe();
    expect(events).toEqual(['offline']);
  });
});
