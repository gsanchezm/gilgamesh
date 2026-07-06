import { embedText } from '@gilgamesh/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_MESSAGES_URL,
  ClaudeApiError,
  ClaudeBrain,
  claudeOptionsFromEnv,
  DEFAULT_BRAIN_MODELS,
} from '../src/infra/claude-brain';

const KEY = 'sk-ant-test-key-000';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    body: null,
  } as unknown as Response;
}

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: (async function* () {
      for (const frame of frames) yield encoder.encode(frame);
    })(),
  } as unknown as Response;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const req = (over: Partial<Parameters<ClaudeBrain['complete']>[0]> = {}) => ({
  tier: 'SONNET' as const,
  system: 'You are a QA assistant.',
  messages: [{ role: 'user', content: 'hello' }],
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClaudeBrain — Anthropic Messages API over fetch (S9)', () => {
  it('complete: posts the tier-mapped model + cap + headers and returns text/usage', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }],
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const brain = new ClaudeBrain({ apiKey: KEY });
    const res = await brain.complete(req());

    expect(res).toEqual({
      text: 'Hello there',
      usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: DEFAULT_BRAIN_MODELS.SONNET,
      max_tokens: 1024,
      system: 'You are a QA assistant.',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(body.stream).toBeUndefined();
  });

  it('complete: a cacheKey marks the system prompt with cache_control (prompt caching)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ content: [], usage: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await new ClaudeBrain({ apiKey: KEY }).complete(req({ cacheKey: 'persona:perf' }));

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.system).toEqual([
      { type: 'text', text: 'You are a QA assistant.', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('streamWithUsage: yields content_block_delta text deltas and resolves real usage', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }),
        frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }),
        frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }),
        frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }),
        frame('message_stop', { type: 'message_stop' }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const brain = new ClaudeBrain({ apiKey: KEY });
    const s = brain.streamWithUsage(req());
    const deltas: string[] = [];
    for await (const ev of s.events) deltas.push(ev.delta);

    expect(deltas).toEqual(['Hel', 'lo']);
    await expect(s.usage).resolves.toEqual({ inputTokens: 10, outputTokens: 7, cacheReadTokens: 0, cacheCreateTokens: 0 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.stream).toBe(true);
  });

  it('retries ONCE on 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await new ClaudeBrain({ apiKey: KEY }).complete(req());
    expect(res.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry on persistent 5xx — and never echoes the key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    vi.stubGlobal('fetch', fetchMock);

    const err = await new ClaudeBrain({ apiKey: KEY }).complete(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClaudeApiError);
    expect((err as ClaudeApiError).status).toBe(503);
    expect((err as Error).message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 401 (non-retryable)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    const err = await new ClaudeBrain({ apiKey: KEY }).complete(req()).catch((e: unknown) => e);
    expect((err as ClaudeApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts and throws when the request exceeds the timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const brain = new ClaudeBrain({ apiKey: KEY, timeoutMs: 10 });
    await expect(brain.complete(req())).rejects.toThrow(/timed out/i);
  });

  it('embed delegates to the deterministic domain lexical hash (S9-2 — no embeddings API)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('embed must not hit the network');
      }),
    );
    const brain = new ClaudeBrain({ apiKey: KEY });
    const [vec] = await brain.embed(['boundary value analysis']);
    expect(vec).toEqual(embedText('boundary value analysis'));
    expect(vec).toHaveLength(1536);
  });

  it('claudeOptionsFromEnv: per-tier model overrides + output cap', () => {
    const opts = claudeOptionsFromEnv({
      BRAIN_MODEL_HAIKU: 'haiku-x',
      BRAIN_MODEL_OPUS: 'opus-x',
      BRAIN_MAX_OUTPUT_TOKENS: '2048',
    } as NodeJS.ProcessEnv);
    expect(opts.models).toEqual({ HAIKU: 'haiku-x', SONNET: DEFAULT_BRAIN_MODELS.SONNET, OPUS: 'opus-x' });
    expect(opts.maxOutputTokens).toBe(2048);
    expect(claudeOptionsFromEnv({} as NodeJS.ProcessEnv).maxOutputTokens).toBe(1024);
  });
});
