import { AGENT_ROSTER, personaPrompt } from '@gilgamesh/domain';
import { describe, expect, it } from 'vitest';
import { DeterministicBrain } from './stub-brain';

const brain = new DeterministicBrain();

function classify(text: string): Promise<string> {
  return brain
    .complete({
      tier: 'HAIKU',
      system: 'You are the Gilgamesh chat router.',
      messages: [{ role: 'user', content: JSON.stringify({ classify: text }) }],
    })
    .then((r) => r.text);
}

function chat(slot: string, text: string): Promise<string> {
  const entry = AGENT_ROSTER.find((e) => e.slot === slot)!;
  return brain
    .complete({ tier: 'SONNET', system: personaPrompt(entry), messages: [{ role: 'user', content: text }] })
    .then((r) => r.text);
}

describe('DeterministicBrain — chat routing classification (AC-ROUTE-01/02)', () => {
  it('classifies a performance-flavored message to perf with high confidence', async () => {
    const parsed = JSON.parse(await classify('our checkout p95 latency explodes under load'));
    expect(parsed.slot).toBe('perf');
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('classifies a security-flavored message to sec', async () => {
    const parsed = JSON.parse(await classify('is this form vulnerable to sql injection?'));
    expect(parsed.slot).toBe('sec');
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('yields low confidence for an unclassifiable message', async () => {
    const parsed = JSON.parse(await classify('hmm not sure, thoughts?'));
    expect(parsed.confidence).toBeLessThan(0.6);
  });

  it('is deterministic: same text, same classification', async () => {
    expect(await classify('load test the api')).toBe(await classify('load test the api'));
  });
});

describe('DeterministicBrain — canned persona answers (AC-ROUTE-05)', () => {
  it('answers with a stable canned response per slot mentioning the deity', async () => {
    const a = await chat('perf', 'how do we approach this?');
    const b = await chat('perf', 'how do we approach this?');
    expect(a).toBe(b);
    expect(a).toContain('Thor');
  });

  it('gives different slots different answers', async () => {
    expect(await chat('perf', 'hello')).not.toBe(await chat('sec', 'hello'));
  });

  it('streams the same answer it completes', async () => {
    const entry = AGENT_ROSTER.find((e) => e.slot === 'a11y')!;
    const req = {
      tier: 'SONNET' as const,
      system: personaPrompt(entry),
      messages: [{ role: 'user', content: 'hello' }],
    };
    let streamed = '';
    for await (const { delta } of brain.stream(req)) streamed += delta;
    expect(streamed).toBe((await brain.complete(req)).text);
  });
});

describe('DeterministicBrain — tool intents (AC-CRUN-01/04)', () => {
  it('emits an enqueue_run tool call for "run the X feature"', async () => {
    const parsed = JSON.parse(await chat('lead', 'run the Checkout feature'));
    expect(parsed).toEqual({ tool: 'enqueue_run', featureName: 'Checkout' });
  });

  it('emits a create_test_case tool call', async () => {
    const parsed = JSON.parse(await chat('lead', 'create a test case for cash payments'));
    expect(parsed).toEqual({ tool: 'create_test_case', title: 'cash payments' });
  });

  it('emits a generate_feature tool call', async () => {
    const parsed = JSON.parse(await chat('lead', 'generate a feature for refunds'));
    expect(parsed).toMatchObject({ tool: 'generate_feature' });
    expect(typeof parsed.prompt).toBe('string');
  });

  it('keeps plain questions as prose (no tool JSON)', async () => {
    const text = await chat('perf', 'what is a good p95 budget?');
    expect(() => {
      const v = JSON.parse(text) as { tool?: string };
      if (v.tool) throw new Error('unexpected tool');
    }).toThrow();
  });
});

describe('DeterministicBrain — legacy draft generation unchanged (AC-GEN-02)', () => {
  it('still returns draft JSON for the GenerateDrafts request shape', async () => {
    const res = await brain.complete({
      tier: 'SONNET',
      system: 'You are a QA authoring assistant.',
      messages: [{ role: 'user', content: JSON.stringify({ prompt: 'checkout flow', format: 'BDD', count: 2 }) }],
    });
    const parsed = JSON.parse(res.text);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].content).toContain('Feature:');
  });
});
