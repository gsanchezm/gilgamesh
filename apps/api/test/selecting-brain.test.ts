import { ApplicationError, DeterministicBrain, StubBrainKeyVerifier } from '@gilgamesh/application';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicKeyVerifier, brainKeyVerifierFromEnv } from '../src/infra/anthropic-key-verifier';
import { ClaudeBrain } from '../src/infra/claude-brain';
import { brainFromEnv, resolveBrainMode, SelectingBrain } from '../src/infra/selecting-brain';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider selection (AC-BRAIN-01/02)', () => {
  it('resolveBrainMode: BRAIN_MODE=offline forces the stub even when a key exists', () => {
    expect(resolveBrainMode(env({ BRAIN_MODE: 'offline', ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBe('offline');
    expect(resolveBrainMode(env())).toBe('offline'); // no key anywhere
    expect(resolveBrainMode(env({ ANTHROPIC_API_KEY: '   ' }))).toBe('offline'); // blank key
    expect(resolveBrainMode(env({ ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBe('auto');
    expect(resolveBrainMode(env({ BRAIN_MODE: 'auto' }))).toBe('offline'); // auto without a key
  });

  it('offline mode: self-reports, stays deterministic, and never touches the network', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline mode must not fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const brain = brainFromEnv(env({ BRAIN_MODE: 'offline', ANTHROPIC_API_KEY: 'sk-ant-x' }));
    expect(brain.mode).toBe('offline');

    const request = {
      tier: 'HAIKU' as const,
      system: 'You are the Gilgamesh chat router. Given {"classify": <message>}, respond ONLY with JSON.',
      messages: [{ role: 'user', content: JSON.stringify({ classify: 'load test the api' }) }],
    };
    const a = await brain.complete(request);
    const b = await brain.complete(request);
    expect(a.text).toBe(b.text); // AC-BRAIN-01: identical inputs -> identical outputs
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto mode: delegates complete/stream/embed + streamWithUsage passthrough to ClaudeBrain', async () => {
    const stub = new DeterministicBrain();
    const claude = {
      complete: vi.fn(async () => ({ text: 'real', usage: { inputTokens: 3, outputTokens: 4 } })),
      stream: vi.fn(async function* () {
        yield { delta: 'real' };
      }),
      embed: vi.fn(async (texts: string[]) => texts.map(() => [0])),
      streamWithUsage: vi.fn(() => ({
        events: (async function* () {
          yield { delta: 'real' };
        })(),
        usage: Promise.resolve({ inputTokens: 3, outputTokens: 4 }),
      })),
    } as unknown as ClaudeBrain;

    const brain = new SelectingBrain({ stub, claude });
    expect(brain.mode).toBe('auto');
    expect((await brain.complete({ tier: 'SONNET', system: '', messages: [] })).text).toBe('real');
    expect(claude.complete).toHaveBeenCalled();
    const s = brain.streamWithUsage({ tier: 'SONNET', system: '', messages: [] });
    await expect(s.usage).resolves.toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(claude.streamWithUsage).toHaveBeenCalled();
    await brain.embed(['x']);
    expect(claude.embed).toHaveBeenCalled();
  });

  it('offline streamWithUsage rides the instance stream() — the BDD fault-injection seam', async () => {
    const brain = new SelectingBrain({ stub: new DeterministicBrain() });
    // Patch exactly like acceptance/steps/brain.steps.ts patchStreamOnce does.
    const original = brain.stream.bind(brain);
    brain.stream = function patched() {
      brain.stream = original;
      return (async function* () {
        yield { delta: '{"tool":"drop_database"}' };
      })();
    };

    const s = brain.streamWithUsage({ tier: 'SONNET', system: 'x', messages: [{ role: 'user', content: 'hi' }] });
    let full = '';
    for await (const ev of s.events) full += ev.delta;
    expect(full).toBe('{"tool":"drop_database"}');
    await expect(s.usage).resolves.toEqual({ inputTokens: 2, outputTokens: full.length });
  });

  it('offline streamWithUsage propagates a stream failure (narratable brain outage, AC-BRAIN-03)', async () => {
    const brain = new SelectingBrain({ stub: new DeterministicBrain() });
    brain.stream = () =>
      (async function* () {
        throw new Error('synthetic brain outage');
        yield { delta: '' }; // eslint-disable-line no-unreachable
      })();

    const s = brain.streamWithUsage({ tier: 'SONNET', system: 'x', messages: [{ role: 'user', content: 'hi' }] });
    await expect(
      (async () => {
        for await (const ev of s.events) void ev;
      })(),
    ).rejects.toThrow('synthetic brain outage');
    await expect(s.usage).rejects.toThrow('synthetic brain outage');
  });
});

describe('AnthropicKeyVerifier (AC-BYOK-02)', () => {
  it('accepts a key the API accepts (1-token HAIKU ping)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'p' }], usage: { input_tokens: 1, output_tokens: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AnthropicKeyVerifier().verify({ key: 'anthropic', token: 'sk-ant-good' })).resolves.toBeUndefined();
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.max_tokens).toBe(1);
  });

  it.each([401, 403])('maps a %d rejection to VALIDATION (nothing stored)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status, json: async () => ({}) })),
    );
    const err = await new AnthropicKeyVerifier()
      .verify({ key: 'anthropic', token: 'sk-ant-bad' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationError);
    expect((err as ApplicationError).code).toBe('VALIDATION');
  });

  it('rejects a blank key locally without any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new AnthropicKeyVerifier().verify({ key: 'anthropic', token: '  ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('brainKeyVerifierFromEnv: real ping only in auto mode, stub verifier offline', () => {
    expect(brainKeyVerifierFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBeInstanceOf(AnthropicKeyVerifier);
    expect(brainKeyVerifierFromEnv(env({ BRAIN_MODE: 'offline', ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBeInstanceOf(
      StubBrainKeyVerifier,
    );
    expect(brainKeyVerifierFromEnv(env())).toBeInstanceOf(StubBrainKeyVerifier);
  });
});
