import { EMBED_DIM, embedText } from '@gilgamesh/domain';
import { DeterministicBrain, type IntegrationRecord, type KindAwareEmbeddingBrain } from '@gilgamesh/application';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brainFromEnv, SelectingBrain } from '../src/infra/selecting-brain';
import {
  DEFAULT_VOYAGE_MODEL,
  VOYAGE_EMBEDDINGS_URL,
  VoyageApiError,
  VoyageBrainEmbedder,
  voyageFromEnv,
  voyageOptionsFromEnv,
} from '../src/infra/voyage-embedder';

const KEY = 'pa-voyage-test-key-000';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

/** A well-formed Voyage embeddings response for `n` inputs (indices in order unless given). */
function voyageResponse(n: number, opts: { totalTokens?: number; indices?: number[]; dim?: number } = {}) {
  const dim = opts.dim ?? EMBED_DIM;
  const indices = opts.indices ?? Array.from({ length: n }, (_, i) => i);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: 'list',
      data: indices.map((index) => ({
        object: 'embedding',
        // A recognizable vector per index so ordering is assertable: [index+1, 0, 0, ...].
        embedding: [index + 1, ...new Array<number>(dim - 1).fill(0)],
        index,
      })),
      model: DEFAULT_VOYAGE_MODEL,
      usage: { total_tokens: opts.totalTokens ?? 7 },
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

describe('VoyageBrainEmbedder — Voyage embeddings API over fetch (S16, AC-EMB-03)', () => {
  it('posts model + input_type + output_dimension + bearer auth and returns vectors with usage', async () => {
    const fetchMock = vi.fn(async () => voyageResponse(2, { totalTokens: 11 }));
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new VoyageBrainEmbedder({ apiKey: KEY });
    const res = await embedder.embedAs(['first text', 'second text'], 'query');

    expect(res.embeddings).toHaveLength(2);
    expect(res.embeddings[0]![0]).toBe(1);
    expect(res.embeddings[1]![0]).toBe(2);
    expect(res.embeddings[0]).toHaveLength(EMBED_DIM);
    expect(res.usage.totalTokens).toBe(11);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VOYAGE_EMBEDDINGS_URL);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      input: ['first text', 'second text'],
      model: DEFAULT_VOYAGE_MODEL,
      input_type: 'query',
      output_dimension: 1024, // keystone v0.5 — the vector(1024) column dimension, pinned explicitly
    });
  });

  it('threads the document input_type', async () => {
    const fetchMock = vi.fn(async () => voyageResponse(1));
    vi.stubGlobal('fetch', fetchMock);
    await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['corpus chunk'], 'document');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.input_type).toBe('document');
  });

  it('batches inputs beyond the batch size, preserves order, and sums total_tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(voyageResponse(2, { totalTokens: 5 }))
      .mockResolvedValueOnce(voyageResponse(1, { totalTokens: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const embedder = new VoyageBrainEmbedder({ apiKey: KEY, batchSize: 2 });
    const res = await embedder.embedAs(['a', 'b', 'c'], 'document');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(first.input).toEqual(['a', 'b']);
    expect(second.input).toEqual(['c']);
    expect(res.embeddings).toHaveLength(3);
    expect(res.usage.totalTokens).toBe(8);
  });

  it('reorders an out-of-order response by index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => voyageResponse(2, { indices: [1, 0] })));
    const res = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['a', 'b'], 'query');
    expect(res.embeddings[0]![0]).toBe(1); // index 0 first despite wire order
    expect(res.embeddings[1]![0]).toBe(2);
  });

  it('returns immediately for an empty input without calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs([], 'document');
    expect(res).toEqual({ embeddings: [], usage: { totalTokens: 0 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries ONCE on 429 then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(errorResponse(429)).mockResolvedValueOnce(voyageResponse(1));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['a'], 'query');
    expect(res.embeddings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry on persistent 5xx — and never echoes the key', async () => {
    const fetchMock = vi.fn(async () => errorResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const err = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['a'], 'query').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoyageApiError);
    expect((err as VoyageApiError).status).toBe(503);
    expect((err as Error).message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 401 (non-retryable)', async () => {
    const fetchMock = vi.fn(async () => errorResponse(401));
    vi.stubGlobal('fetch', fetchMock);
    const err = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['a'], 'query').catch((e: unknown) => e);
    expect((err as VoyageApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts and throws when the request exceeds the timeout', async () => {
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
    const embedder = new VoyageBrainEmbedder({ apiKey: KEY, timeoutMs: 10 });
    await expect(embedder.embedAs(['a'], 'query')).rejects.toThrow(/timed out/i);
  });

  it('rejects a response with a mismatched vector count or dimension (fail fast, key never echoed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => voyageResponse(1, { dim: 8 })));
    const err = await new VoyageBrainEmbedder({ apiKey: KEY }).embedAs(['a'], 'query').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoyageApiError);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('voyageOptionsFromEnv: VOYAGE_MODEL override with the voyage-4 default', () => {
    expect(voyageOptionsFromEnv(env()).model).toBe('voyage-4');
    expect(voyageOptionsFromEnv(env({ VOYAGE_MODEL: 'voyage-4-lite' })).model).toBe('voyage-4-lite');
  });

  it('voyageFromEnv: built only when VOYAGE_API_KEY is set AND BRAIN_MODE != offline', () => {
    expect(voyageFromEnv(env())).toBeUndefined();
    expect(voyageFromEnv(env({ VOYAGE_API_KEY: '  ' }))).toBeUndefined();
    expect(voyageFromEnv(env({ VOYAGE_API_KEY: KEY, BRAIN_MODE: 'offline' }))).toBeUndefined();
    expect(voyageFromEnv(env({ VOYAGE_API_KEY: KEY }))).toBeInstanceOf(VoyageBrainEmbedder);
  });
});

describe('SelectingBrain — embed routing (S16)', () => {
  const recordedKinds: string[] = [];

  function fakeVoyage() {
    recordedKinds.length = 0;
    return {
      embedAs: vi.fn(async (texts: string[], kind: string) => {
        recordedKinds.push(kind);
        return { embeddings: texts.map(() => [42]), usage: { totalTokens: texts.length } };
      }),
    };
  }

  it('routes embed()/embedAs() to Voyage when configured (embed defaults to document kind)', async () => {
    const voyage = fakeVoyage();
    const brain = new SelectingBrain({ stub: new DeterministicBrain(), voyage });
    expect(brain.embeddings).toBe('voyage');

    const vecs = await brain.embed(['x', 'y']);
    expect(vecs).toEqual([[42], [42]]);
    const r = await brain.embedAs(['q'], 'query');
    expect(r.usage.totalTokens).toBe(1);
    expect(recordedKinds).toEqual(['document', 'query']);
  });

  it('falls back to the lexical stub without Voyage (identical to the domain embedText, 1024-dim)', async () => {
    const brain = new SelectingBrain({ stub: new DeterministicBrain() });
    expect(brain.embeddings).toBe('lexical');
    const [vec] = await brain.embed(['boundary value analysis']);
    expect(vec).toEqual(embedText('boundary value analysis'));
    expect(vec).toHaveLength(1024);
    const viaKind = await brain.embedAs(['boundary value analysis'], 'query');
    expect(viaKind.embeddings[0]).toEqual(vec);
    expect(viaKind.usage.totalTokens).toBe(3); // the stub's whitespace estimate
  });

  it('forOrg handles without a voyage factory keep PLATFORM embeddings (one embedding space)', async () => {
    // S19: an org's ANTHROPIC key must never fork the shared embedding space — only a voyage
    // BYOK factory (makeVoyage) reroutes embeds, and this brain has none wired.
    const voyage = fakeVoyage();
    const perOrgEmbed = vi.fn(async (texts: string[]) => texts.map(() => [0]));
    const claude = {
      complete: vi.fn(async () => ({ text: 'real', usage: { inputTokens: 1, outputTokens: 1 } })),
      stream: vi.fn(),
      embed: perOrgEmbed,
      streamWithUsage: vi.fn(),
    };
    const brain = new SelectingBrain(
      { stub: new DeterministicBrain(), claude: claude as never, voyage },
      {
        integrations: { findByKey: vi.fn(async () => null) },
        vault: { get: vi.fn(async () => null) },
        makeClaude: vi.fn(),
      },
    );
    const vecs = await brain.forOrg('org-1').embed(['x']);
    expect(vecs).toEqual([[42]]); // platform Voyage, NOT the per-org/platform Claude lexical path
    expect(perOrgEmbed).not.toHaveBeenCalled();
  });

  it('brainFromEnv: BRAIN_MODE=offline forces lexical embeddings even with a Voyage key', () => {
    const offline = brainFromEnv(env({ BRAIN_MODE: 'offline', VOYAGE_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-x' }));
    expect(offline.mode).toBe('offline');
    expect(offline.embeddings).toBe('lexical');
  });

  it('brainFromEnv: a Voyage key without an Anthropic key gives stub chat + Voyage embeddings', () => {
    const brain = brainFromEnv(env({ VOYAGE_API_KEY: KEY }));
    expect(brain.mode).toBe('offline'); // chat/completions stay on the stub
    expect(brain.embeddings).toBe('voyage'); // embeddings are real
  });

  it('brainFromEnv: both keys -> auto chat + Voyage embeddings', () => {
    const brain = brainFromEnv(env({ VOYAGE_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-x' }));
    expect(brain.mode).toBe('auto');
    expect(brain.embeddings).toBe('voyage');
  });
});

describe('SelectingBrain — org voyage BYOK call-time resolution (S19, AC-VBYOK-05)', () => {
  const voyageRow = (orgId: string, secretRef: string | null, connected = true): IntegrationRecord => ({
    id: `int-${orgId}`,
    orgId,
    key: 'voyage',
    group: 'AI_PROVIDERS',
    connected,
    secretRef,
    config: {},
    connectedById: null,
    connectedAt: null,
  });

  /** A per-org embedder whose vectors carry the key it was built with, so routing is assertable. */
  function orgEmbedder(apiKey: string): KindAwareEmbeddingBrain {
    return {
      embedAs: vi.fn(async (texts: string[], kind: string) => ({
        embeddings: texts.map(() => [`org:${apiKey}:${kind}`] as unknown as number[]),
        usage: { totalTokens: texts.length },
      })),
    };
  }

  function makeVoyageByok(over: {
    rows?: Record<string, IntegrationRecord | undefined>;
    secrets?: Record<string, string>;
    platformVoyage?: boolean;
    maxOrgBrains?: number;
  }) {
    const platform = {
      embedAs: vi.fn(async (texts: string[], kind: string) => ({
        embeddings: texts.map(() => [`platform:${kind}`] as unknown as number[]),
        usage: { totalTokens: texts.length },
      })),
    };
    const findByKey = vi.fn(async (orgId: string, key: string) => (key === 'voyage' ? (over.rows?.[orgId] ?? null) : null));
    const get = vi.fn(async (scope: string) => over.secrets?.[scope] ?? null);
    const makeVoyage = vi.fn((apiKey: string) => orgEmbedder(apiKey));
    const brain = new SelectingBrain(
      { stub: new DeterministicBrain(), voyage: over.platformVoyage === false ? undefined : platform },
      { integrations: { findByKey }, vault: { get }, makeVoyage, maxOrgBrains: over.maxOrgBrains },
    );
    return { brain, platform, findByKey, get, makeVoyage };
  }

  /** The handle is typed as the frozen port; the S16 extension rides it (hasEmbedAs at runtime). */
  function handleOf(brain: SelectingBrain, orgId: string) {
    return brain.forOrg(orgId) as ReturnType<SelectingBrain['forOrg']> & KindAwareEmbeddingBrain;
  }

  it('a connected org row resolves the vaulted key and embeds with the per-org embedder', async () => {
    const { brain, platform, findByKey, get, makeVoyage } = makeVoyageByok({
      rows: { 'org-1': voyageRow('org-1', 'vault://org-1/voyage') },
      secrets: { 'org-1/voyage': 'pa-org-1' },
    });
    const res = await handleOf(brain, 'org-1').embedAs(['q'], 'query');
    expect(res.embeddings).toEqual([['org:pa-org-1:query']]);
    expect(findByKey).toHaveBeenCalledWith('org-1', 'voyage');
    expect(get).toHaveBeenCalledWith('org-1/voyage'); // scope = secretRef minus 'vault://'
    expect(makeVoyage).toHaveBeenCalledWith('pa-org-1');
    expect(platform.embedAs).not.toHaveBeenCalled();
  });

  it('the frozen embed() on the org handle rides the per-org embedder with document semantics', async () => {
    const { brain } = makeVoyageByok({
      rows: { 'org-1': voyageRow('org-1', 'vault://org-1/voyage') },
      secrets: { 'org-1/voyage': 'pa-org-1' },
    });
    const vecs = await brain.forOrg('org-1').embed(['x']);
    expect(vecs).toEqual([['org:pa-org-1:document']]);
  });

  it('no org row -> the platform Voyage embedder serves', async () => {
    const { brain, get, makeVoyage } = makeVoyageByok({ rows: {} });
    const res = await handleOf(brain, 'org-1').embedAs(['q'], 'query');
    expect(res.embeddings).toEqual([['platform:query']]);
    expect(get).not.toHaveBeenCalled();
    expect(makeVoyage).not.toHaveBeenCalled();
  });

  it('no org row AND no platform key -> the deterministic lexical stub serves (no key at all)', async () => {
    const { brain } = makeVoyageByok({ rows: {}, platformVoyage: false });
    const [vec] = await brain.forOrg('org-1').embed(['boundary value analysis']);
    expect(vec).toEqual(embedText('boundary value analysis'));
  });

  it('an org row without a vault entry falls through to the platform embedder', async () => {
    const { brain, makeVoyage } = makeVoyageByok({
      rows: { 'org-1': voyageRow('org-1', 'vault://org-1/voyage') },
      secrets: {},
    });
    const res = await handleOf(brain, 'org-1').embedAs(['q'], 'query');
    expect(res.embeddings).toEqual([['platform:query']]);
    expect(makeVoyage).not.toHaveBeenCalled();
  });

  it('DISCONNECT bites on the very next call (per-call row re-read)', async () => {
    const rows: Record<string, IntegrationRecord | undefined> = {
      'org-1': voyageRow('org-1', 'vault://org-1/voyage'),
    };
    const { brain } = makeVoyageByok({ rows, secrets: { 'org-1/voyage': 'pa-org-1' } });
    const org = handleOf(brain, 'org-1');
    expect((await org.embedAs(['q'], 'query')).embeddings).toEqual([['org:pa-org-1:query']]);
    rows['org-1'] = voyageRow('org-1', null, false); // PATCH …/integrations/voyage disconnect
    expect((await org.embedAs(['q'], 'query')).embeddings).toEqual([['platform:query']]);
  });

  it('caches the per-org embedder by orgId+secretRef; rotation misses and rebuilds', async () => {
    const rows: Record<string, IntegrationRecord | undefined> = {
      'org-1': voyageRow('org-1', 'vault://org-1/voyage@v1'),
    };
    const { brain, findByKey, get, makeVoyage } = makeVoyageByok({
      rows,
      secrets: { 'org-1/voyage@v1': 'pa-old', 'org-1/voyage@v2': 'pa-new' },
    });
    const org = handleOf(brain, 'org-1');
    await org.embedAs(['a'], 'query');
    await org.embedAs(['b'], 'document');
    expect(makeVoyage).toHaveBeenCalledTimes(1); // cached
    expect(get).toHaveBeenCalledTimes(1);
    expect(findByKey).toHaveBeenCalledTimes(2); // the row is re-read EVERY call

    rows['org-1'] = voyageRow('org-1', 'vault://org-1/voyage@v2'); // key rotation
    expect((await org.embedAs(['c'], 'query')).embeddings).toEqual([['org:pa-new:query']]);
    expect(makeVoyage).toHaveBeenNthCalledWith(2, 'pa-new');
  });

  it('voyage-only BYOK keeps chat on the deterministic stub through the handle', async () => {
    const { brain } = makeVoyageByok({
      rows: { 'org-1': voyageRow('org-1', 'vault://org-1/voyage') },
      secrets: { 'org-1/voyage': 'pa-org-1' },
    });
    const org = brain.forOrg('org-1');
    const req = { tier: 'HAIKU' as const, system: 'x', messages: [{ role: 'user', content: 'hi' }] };
    const a = await org.complete(req);
    const b = await org.complete(req);
    expect(a.text).toBe(b.text); // deterministic stub chat, unchanged by voyage BYOK
  });

  it('brainFromEnv wires org voyage resolution: the org key reaches the wire, never the logs', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        object: 'list',
        data: [{ object: 'embedding', embedding: new Array<number>(EMBED_DIM).fill(0.5), index: 0 }],
        usage: { total_tokens: 2 },
      }),
      body: null,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const brain = brainFromEnv(env(), {
      integrations: { findByKey: async () => voyageRow('org-1', 'vault://org-1/voyage') } as never,
      vault: { get: async () => 'pa-org-wire-key' } as never,
    });
    expect(brain.embeddings).toBe('lexical'); // no PLATFORM key — but the ORG key still resolves
    await brain.forOrg('org-1').embed(['x']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(VOYAGE_EMBEDDINGS_URL);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pa-org-wire-key');
  });

  it('brainFromEnv with BRAIN_MODE=offline never wires voyage BYOK: forOrg is the identity', () => {
    const findByKey = vi.fn();
    const brain = brainFromEnv(env({ BRAIN_MODE: 'offline', VOYAGE_API_KEY: KEY }), {
      integrations: { findByKey } as never,
      vault: { get: vi.fn() } as never,
    });
    expect(brain.forOrg('org-1')).toBe(brain); // the stub path + the BDD fault-injection seam
    expect(findByKey).not.toHaveBeenCalled();
  });
});
