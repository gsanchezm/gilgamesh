import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, sendJson, ok, HttpError } from './http';

type FetchInit = { method?: string; signal?: AbortSignal };

/**
 * A fake `sleep` so the backoff never really waits: retry tests run in microtask time. We record
 * the requested delays to assert the backoff schedule (200 ms, 400 ms).
 */
function fakeSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpError', () => {
  it('is an Error whose .message equals its .detail (back-compat for catch(e){e.message})', () => {
    const err = new HttpError('Feature not found.', { status: 404 });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Feature not found.');
    expect(err.detail).toBe('Feature not found.');
    expect(err.status).toBe(404);
    expect(err.isTimeout).toBe(false);
    expect(err.isNetwork).toBe(false);
  });
});

describe('getJson — timeout (AC-HTTP-01)', () => {
  it('rejects with a typed timeout error instead of hanging, and does not retry past the deadline', async () => {
    // fetch never resolves on its own — it only settles when our AbortController fires.
    const fetchMock = vi.fn(
      (_url: string, init: FetchInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { delays, sleep } = fakeSleep();
    const err = (await getJson('/slow', 'Could not load.', { timeoutMs: 15, sleep }).catch(
      (e) => e,
    )) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.isTimeout).toBe(true);
    expect(err.status).toBeNull();
    // Timeout is terminal — one attempt only, no backoff sleep.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});

describe('getJson — transient retry (AC-HTTP-02)', () => {
  it('retries a 503 then resolves with the eventual success payload (backoff slept once)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ detail: 'unavailable' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: 42 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { delays, sleep } = fakeSleep();
    const result = await getJson<{ value: number }>('/flaky', 'Could not load.', { sleep });

    expect(result).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([200]); // first backoff only
  });

  it('retries a thrown network error then resolves (network errors are transient for GETs)', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ value: 7 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { sleep } = fakeSleep();
    const result = await getJson<{ value: number }>('/flaky', 'Could not load.', { sleep });

    expect(result).toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getJson — exhausted retries (AC-HTTP-03)', () => {
  it('gives up after N retries on a persistent 503 and throws the typed error (status 503)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Service unavailable.' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { delays, sleep } = fakeSleep();
    const err = (await getJson('/down', 'Could not load.', { sleep }).catch((e) => e)) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(err.message).toBe('Service unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(delays).toEqual([200, 400]); // exponential backoff between the three attempts
  });
});

describe('getJson — 4xx is terminal (AC-HTTP-04)', () => {
  it('never retries a 404 and surfaces the RFC9457 detail as .message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Feature not found.' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { delays, sleep } = fakeSleep();
    const err = (await getJson('/missing', 'fallback text', { sleep }).catch((e) => e)) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Feature not found.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('falls back to the caller fallback when the error body has no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
    const err = (await getJson('/bad', 'Could not load runs.').catch((e) => e)) as HttpError;
    expect(err.message).toBe('Could not load runs.');
  });
});

describe('sendJson — mutations are NEVER retried (AC-HTTP-05)', () => {
  it('does not retry a 503 on a POST (non-idempotent) — fetch called exactly once', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: 'Service unavailable.' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { delays, sleep } = fakeSleep();
    const err = (await sendJson(
      'POST',
      '/projects/p1/runs',
      { targetId: 'f1' },
      'Could not start.',
      { sleep },
    ).catch((e) => e)) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    // A retried POST could double-create/double-charge — it must fire exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('sends the CSRF header + JSON body + credentials (unchanged mutation behaviour)', async () => {
    document.cookie = 'csrf=tok-9';
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 'r1' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await sendJson('POST', '/projects/p1/runs', { targetId: 'f1' }, 'Could not start.');

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      FetchInit & { headers?: Record<string, string>; credentials?: string; body?: string },
    ];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-9');
    expect(JSON.parse(init.body!)).toEqual({ targetId: 'f1' });
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

describe('happy paths + ok (AC-HTTP-06 back-compat)', () => {
  it('getJson resolves the JSON with credentials (no CSRF) on 200', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'r1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getJson<Array<{ id: string }>>('/projects/p1/runs', 'Could not load.');
    expect(result).toEqual([{ id: 'r1' }]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit & { credentials?: string }];
    expect(init.credentials).toBe('include');
    expect(init.method).toBeUndefined();
  });

  it('ok() throws an HttpError carrying the status + detail', async () => {
    const res = { ok: false, status: 409, json: async () => ({ detail: 'already exists' }) } as unknown as Response;
    const err = (await ok(res, 'fallback').catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('already exists');
  });
});
