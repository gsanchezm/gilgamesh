import { ApplicationError, StubBrainKeyVerifier } from '@gilgamesh/application';
import { EMBED_DIM } from '@gilgamesh/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brainKeyVerifierFromEnv } from '../src/infra/anthropic-key-verifier';
import { VOYAGE_EMBEDDINGS_URL } from '../src/infra/voyage-embedder';
import { VoyageKeyVerifier } from '../src/infra/voyage-key-verifier';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

function pingResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: 'list',
      data: [{ object: 'embedding', embedding: new Array<number>(EMBED_DIM).fill(0.1), index: 0 }],
      usage: { total_tokens: 1 },
    }),
    body: null,
  } as unknown as Response;
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}), body: null } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoyageKeyVerifier (S19, AC-VBYOK-06)', () => {
  it('accepts a key Voyage accepts — exactly ONE minimal embed ping with the candidate key', async () => {
    const fetchMock = vi.fn(async () => pingResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(new VoyageKeyVerifier().verify({ key: 'voyage', token: 'pa-voyage-good' })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VOYAGE_EMBEDDINGS_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pa-voyage-good');
    const body = JSON.parse(String(init.body));
    expect(body.input).toEqual(['ping']); // minimal: a single 1-token input
  });

  it.each([400, 401, 403])('maps a %d rejection to VALIDATION without echoing the key', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(status)));
    const err = await new VoyageKeyVerifier().verify({ key: 'voyage', token: 'pa-voyage-bad' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationError);
    expect((err as ApplicationError).code).toBe('VALIDATION');
    expect((err as Error).message).not.toContain('pa-voyage-bad');
  });

  it('rejects a blank key locally without any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new VoyageKeyVerifier().verify({ key: 'voyage', token: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates a provider outage (5xx after the single retry) — never silently accepts', async () => {
    const fetchMock = vi.fn(async () => errorResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const err = await new VoyageKeyVerifier().verify({ key: 'voyage', token: 'pa-voyage-x' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApplicationError); // NOT a key rejection
    expect(fetchMock).toHaveBeenCalledTimes(2); // the embedder's one retry
  });

  it('propagates throttling (429 after retry) instead of rejecting the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse(429)));
    const err = await new VoyageKeyVerifier().verify({ key: 'voyage', token: 'pa-voyage-x' }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApplicationError);
  });

  it('propagates a timeout instead of rejecting the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
    const err = await new VoyageKeyVerifier({ timeoutMs: 10 })
      .verify({ key: 'voyage', token: 'pa-voyage-x' })
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApplicationError);
    expect((err as Error).message).toMatch(/timed out/i);
  });
});

describe('brainKeyVerifierFromEnv — per-provider key routing (S19)', () => {
  it('explicit BRAIN_MODE=offline pins the stub for every provider', () => {
    expect(brainKeyVerifierFromEnv(env({ BRAIN_MODE: 'offline', ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBeInstanceOf(
      StubBrainKeyVerifier,
    );
    expect(brainKeyVerifierFromEnv(env({ BRAIN_MODE: 'offline', VOYAGE_API_KEY: 'pa-x' }))).toBeInstanceOf(
      StubBrainKeyVerifier,
    );
  });

  it('a voyage connect pings Voyage with the candidate key (not Anthropic)', async () => {
    const fetchMock = vi.fn(async () => pingResponse());
    vi.stubGlobal('fetch', fetchMock);
    const verifier = brainKeyVerifierFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant-platform' }));
    await verifier.verify({ key: 'voyage', token: 'pa-voyage-candidate' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VOYAGE_EMBEDDINGS_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pa-voyage-candidate');
  });

  it('an anthropic connect keeps the S9 path: real ping in auto mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'p' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const verifier = brainKeyVerifierFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant-platform' }));
    await verifier.verify({ key: 'anthropic', token: 'sk-ant-candidate' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toBe(VOYAGE_EMBEDDINGS_URL); // the Messages API, not the embeddings API
  });

  it('without a platform Anthropic key, anthropic connects fall back to the stub while voyage stays real', async () => {
    const fetchMock = vi.fn(async () => pingResponse());
    vi.stubGlobal('fetch', fetchMock);
    const verifier = brainKeyVerifierFromEnv(env()); // BRAIN_MODE unset, no platform keys
    await verifier.verify({ key: 'anthropic', token: 'sk-ant-anything' }); // stub accepts, no network
    expect(fetchMock).not.toHaveBeenCalled();
    await verifier.verify({ key: 'voyage', token: 'pa-voyage-candidate' }); // real Voyage ping
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
