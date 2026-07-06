import {
  ApplicationError,
  DeterministicBrain,
  hasBrainForOrg,
  hasStreamWithUsage,
  StubBrainKeyVerifier,
  type AgentBrainPort,
  type IntegrationRecord,
  type UsageReportingBrain,
} from '@gilgamesh/application';
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

describe('forOrg — org-BYOK call-time resolution (S9 follow-up of AC-BRAIN-02)', () => {
  const req = { tier: 'SONNET' as const, system: 'persona', messages: [{ role: 'user', content: 'hi' }] };

  function fakeClaude(label: string) {
    return {
      complete: vi.fn(async () => ({ text: label, usage: { inputTokens: 1, outputTokens: 2 } })),
      stream: vi.fn(() =>
        (async function* () {
          yield { delta: label };
        })(),
      ),
      embed: vi.fn(async (texts: string[]) => texts.map(() => [0])),
      streamWithUsage: vi.fn(() => ({
        events: (async function* () {
          yield { delta: label };
        })(),
        usage: Promise.resolve({ inputTokens: 7, outputTokens: 9, cacheReadTokens: 0, cacheCreateTokens: 0 }),
      })),
    };
  }

  const anthropicRow = (orgId: string, secretRef: string | null, connected = true): IntegrationRecord => ({
    id: `int-${orgId}`,
    orgId,
    key: 'anthropic',
    group: 'AI_PROVIDERS',
    connected,
    secretRef,
    config: {},
    connectedById: null,
    connectedAt: null,
  });

  function makeByokBrain(over: {
    rows?: Record<string, IntegrationRecord | undefined>;
    secrets?: Record<string, string>;
    maxOrgBrains?: number;
  }) {
    const platform = fakeClaude('platform');
    const findByKey = vi.fn(async (orgId: string, _key: string) => over.rows?.[orgId] ?? null);
    const get = vi.fn(async (scope: string) => over.secrets?.[scope] ?? null);
    const makeClaude = vi.fn(
      (apiKey: string) => fakeClaude(`org:${apiKey}`) as unknown as AgentBrainPort & UsageReportingBrain,
    );
    const brain = new SelectingBrain(
      { stub: new DeterministicBrain(), claude: platform as unknown as ClaudeBrain },
      { integrations: { findByKey }, vault: { get }, makeClaude, maxOrgBrains: over.maxOrgBrains },
    );
    return { brain, platform, findByKey, get, makeClaude };
  }

  it('BYOK connected: parses the scope from the secretRef, reads the vault, answers with the per-org brain', async () => {
    const { brain, platform, get, makeClaude } = makeByokBrain({
      rows: { 'org-1': anthropicRow('org-1', 'vault://org-1/anthropic') },
      secrets: { 'org-1/anthropic': 'sk-org-1' },
    });
    expect(hasBrainForOrg(brain)).toBe(true);
    const res = await brain.forOrg('org-1').complete(req);
    expect(res.text).toBe('org:sk-org-1');
    expect(get).toHaveBeenCalledWith('org-1/anthropic'); // scope = secretRef minus 'vault://'
    expect(makeClaude).toHaveBeenCalledWith('sk-org-1');
    expect(platform.complete).not.toHaveBeenCalled();
  });

  it('not connected: the platform-key brain answers; nothing is read or built', async () => {
    const { brain, platform, get, makeClaude } = makeByokBrain({ rows: {} });
    expect((await brain.forOrg('org-1').complete(req)).text).toBe('platform');
    expect(get).not.toHaveBeenCalled();
    expect(makeClaude).not.toHaveBeenCalled();
    expect(platform.complete).toHaveBeenCalledTimes(1);
  });

  it('BYOK row without a vault entry falls through to the platform key (spec 09 s12)', async () => {
    const { brain, platform, makeClaude } = makeByokBrain({
      rows: { 'org-1': anthropicRow('org-1', 'vault://org-1/anthropic') },
      secrets: {},
    });
    expect((await brain.forOrg('org-1').complete(req)).text).toBe('platform');
    expect(makeClaude).not.toHaveBeenCalled();
    expect(platform.complete).toHaveBeenCalledTimes(1);
  });

  it('caches the per-org instance by orgId+secretRef: one vault read + one build across calls', async () => {
    const { brain, findByKey, get, makeClaude } = makeByokBrain({
      rows: { 'org-1': anthropicRow('org-1', 'vault://org-1/anthropic') },
      secrets: { 'org-1/anthropic': 'sk-org-1' },
    });
    const org = brain.forOrg('org-1');
    await org.complete(req);
    await org.complete(req);
    await brain.forOrg('org-1').complete(req); // a fresh handle hits the same cache
    expect(makeClaude).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(findByKey).toHaveBeenCalledTimes(3); // the row is re-read EVERY call so disconnect bites
  });

  it('DISCONNECT invalidates on the very next call (call-time row read)', async () => {
    const rows: Record<string, IntegrationRecord | undefined> = {
      'org-1': anthropicRow('org-1', 'vault://org-1/anthropic'),
    };
    const { brain, platform } = makeByokBrain({ rows, secrets: { 'org-1/anthropic': 'sk-org-1' } });
    const org = brain.forOrg('org-1');
    expect((await org.complete(req)).text).toBe('org:sk-org-1');
    rows['org-1'] = anthropicRow('org-1', null, false); // PATCH …/integrations/anthropic disconnect
    expect((await org.complete(req)).text).toBe('platform');
    expect(platform.complete).toHaveBeenCalledTimes(1);
  });

  it('a rotated secretRef naturally misses the cache and rebuilds with the new key', async () => {
    const rows: Record<string, IntegrationRecord | undefined> = {
      'org-1': anthropicRow('org-1', 'vault://org-1/anthropic@v1'),
    };
    const { brain, makeClaude } = makeByokBrain({
      rows,
      secrets: { 'org-1/anthropic@v1': 'sk-old', 'org-1/anthropic@v2': 'sk-new' },
    });
    const org = brain.forOrg('org-1');
    expect((await org.complete(req)).text).toBe('org:sk-old');
    rows['org-1'] = anthropicRow('org-1', 'vault://org-1/anthropic@v2'); // key rotation
    expect((await org.complete(req)).text).toBe('org:sk-new');
    expect(makeClaude).toHaveBeenNthCalledWith(1, 'sk-old');
    expect(makeClaude).toHaveBeenNthCalledWith(2, 'sk-new');
  });

  it('caps the cache LRU-ish: the least-recently-used org is evicted first', async () => {
    const rows: Record<string, IntegrationRecord | undefined> = {
      'org-1': anthropicRow('org-1', 'vault://org-1/anthropic'),
      'org-2': anthropicRow('org-2', 'vault://org-2/anthropic'),
      'org-3': anthropicRow('org-3', 'vault://org-3/anthropic'),
    };
    const secrets = { 'org-1/anthropic': 'sk-1', 'org-2/anthropic': 'sk-2', 'org-3/anthropic': 'sk-3' };
    const { brain, makeClaude } = makeByokBrain({ rows, secrets, maxOrgBrains: 2 });
    await brain.forOrg('org-1').complete(req); // build 1
    await brain.forOrg('org-2').complete(req); // build 2 (cache full)
    await brain.forOrg('org-1').complete(req); // hit -> refreshes org-1 recency
    await brain.forOrg('org-3').complete(req); // build 3 -> evicts org-2 (LRU), not org-1
    await brain.forOrg('org-1').complete(req); // still cached
    expect(makeClaude).toHaveBeenCalledTimes(3);
    await brain.forOrg('org-2').complete(req); // evicted -> rebuilt
    expect(makeClaude).toHaveBeenCalledTimes(4);
  });

  it('streamWithUsage on the org handle passes the org brain REAL usage through (CHAT metering)', async () => {
    const { brain } = makeByokBrain({
      rows: { 'org-1': anthropicRow('org-1', 'vault://org-1/anthropic') },
      secrets: { 'org-1/anthropic': 'sk-org-1' },
    });
    const org = brain.forOrg('org-1');
    expect(hasStreamWithUsage(org)).toBe(true);
    const s = (org as AgentBrainPort & UsageReportingBrain).streamWithUsage(req);
    let text = '';
    for await (const ev of s.events) text += ev.delta;
    expect(text).toBe('org:sk-org-1');
    await expect(s.usage).resolves.toMatchObject({ inputTokens: 7, outputTokens: 9 });
  });

  it('offline mode: forOrg keeps the deterministic stub path and never looks anything up', async () => {
    const findByKey = vi.fn();
    const get = vi.fn();
    const brain = new SelectingBrain(
      { stub: new DeterministicBrain() },
      { integrations: { findByKey }, vault: { get }, makeClaude: vi.fn() },
    );
    expect(hasBrainForOrg(brain)).toBe(true);
    const org = brain.forOrg('org-1');
    const a = await org.complete(req);
    const b = await org.complete(req);
    expect(a.text).toBe(b.text); // deterministic (AC-BRAIN-01 preserved through forOrg)
    expect(findByKey).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
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

  it('brainKeyVerifierFromEnv: stub offline; a routing verifier otherwise (S19 — voyage dispatches by key)', async () => {
    // Explicit offline pins the stub for EVERY provider (the harness/CI posture).
    expect(brainKeyVerifierFromEnv(env({ BRAIN_MODE: 'offline', ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBeInstanceOf(
      StubBrainKeyVerifier,
    );
    expect(brainKeyVerifierFromEnv(env({ BRAIN_MODE: 'offline' }))).toBeInstanceOf(StubBrainKeyVerifier);

    // Auto mode: anthropic keys still hit the real 1-token ping (the S9 behavior, now behind routing).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    const auto = brainKeyVerifierFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant-x' }));
    await expect(auto.verify({ key: 'anthropic', token: 'sk-ant-candidate' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    // No platform Anthropic key: anthropic connects keep the stub path (accepts without network).
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('the anthropic stub path must not fetch');
      }),
    );
    await expect(brainKeyVerifierFromEnv(env()).verify({ key: 'anthropic', token: 'sk-ant-x' })).resolves.toBeUndefined();
  });
});
