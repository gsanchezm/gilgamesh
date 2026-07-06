import { AGENT_ROSTER, embedText, type AgentSlot } from '@gilgamesh/domain';
import type {
  AgentBrainPort,
  BrainCompleteRequest,
  BrainCompleteResult,
  BrainStreamWithUsage,
  EmbeddingKind,
  EmbedWithUsageResult,
  KindAwareEmbeddingBrain,
  UsageReportingBrain,
} from '../ports/brain';
import { CHAT_ROUTER_PREFIX } from '../use-cases/chat';

/**
 * Deterministic, offline {@link AgentBrainPort} stub: no network, no randomness — the real Claude
 * adapter drops in later behind the same port. It serves three request shapes:
 *  1. Router classification (slice 8): a `{"classify": <text>}` user message → keyword-derived
 *     `{"slot", "confidence"}` JSON.
 *  2. Chat persona answers (slice 8): a system prompt carrying the domain `(slot: <key>` marker →
 *     a canned per-slot answer, or a whitelisted tool-call JSON when the message asks for an action.
 *  3. Test-draft generation (slice 2): a `{prompt, format, count}` user message → draft JSON
 *     (the shape is the contract owned by the GenerateDrafts use case).
 */
export class DeterministicBrain implements AgentBrainPort, UsageReportingBrain, KindAwareEmbeddingBrain {
  async complete(req: BrainCompleteRequest): Promise<BrainCompleteResult> {
    const last = req.messages[req.messages.length - 1]?.content ?? '';

    // Dispatch on CALLER intent — the system prompt's anchored prefix — never on user or grounding
    // content (review S8: a chat message that happens to be {"classify"} JSON, or RAG grounding
    // containing persona-like text, must not change which branch answers).
    if (req.system.startsWith(CHAT_ROUTER_PREFIX)) {
      return result(last, JSON.stringify(classifyChat(classifyPayload(last))));
    }
    const persona = AGENT_ROSTER.find((e) => req.system.startsWith(`You are ${e.deityName},`));
    if (persona) return result(last, chatAnswer(persona.slot, last));

    return this.legacyDrafts(last);
  }

  // stream/embed are part of the frozen port; stream replays the completion (real token streaming
  // arrives with the Brain slice), embed is the slice-5 deterministic lexical hash.
  async *stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }> {
    const { text } = await this.complete(req);
    yield { delta: text };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedText(t));
  }

  /** S16 optional extension (spec 16 §5): the lexical hash has no query/document asymmetry — the kind
   *  is accepted for wire parity with Voyage. Usage is a deterministic whitespace-token estimate so
   *  offline EMBED metering rows still carry meaningful counts. */
  async embedAs(texts: string[], kind: EmbeddingKind): Promise<EmbedWithUsageResult> {
    void kind;
    return {
      embeddings: texts.map((t) => embedText(t)),
      usage: { totalTokens: texts.reduce((sum, t) => sum + (t.match(/\S+/g) ?? []).length, 0) },
    };
  }

  /** S9 optional extension (spec 09 s13): stream + final usage, so streamed calls can be metered. */
  streamWithUsage(req: BrainCompleteRequest): BrainStreamWithUsage {
    let resolveUsage!: (u: { inputTokens: number; outputTokens: number }) => void;
    const usage = new Promise<{ inputTokens: number; outputTokens: number }>((r) => (resolveUsage = r));
    const complete = this.complete.bind(this);
    const events = (async function* () {
      const res = await complete(req);
      yield { delta: res.text };
      resolveUsage(res.usage);
    })();
    return { events, usage };
  }

  /** Slice-2 behavior, unchanged: reproducible well-formed draft JSON derived from the request. */
  private async legacyDrafts(last: string): Promise<BrainCompleteResult> {
    let parsed: { prompt?: unknown; format?: unknown; count?: unknown };
    try {
      parsed = JSON.parse(last) as typeof parsed;
    } catch {
      parsed = {};
    }
    const title = (typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '').slice(0, 60) || 'Untitled';
    const format = parsed.format === 'TRADITIONAL' ? 'TRADITIONAL' : 'BDD';
    const count = clamp(Number(parsed.count) || 3, 1, 10);

    const body =
      format === 'BDD'
        ? { features: [this.featureDraft(title, count)], testCases: [] }
        : { features: [], testCases: this.testCaseDrafts(title, count) };

    return result(last, JSON.stringify(body));
  }

  private featureDraft(title: string, count: number): { name: string; path: string; content: string } {
    const scenarios = Array.from({ length: count }, (_, i) =>
      `  Scenario: ${title} case ${i + 1}\n    Given a precondition\n    When action ${i + 1} happens\n    Then the expected outcome ${i + 1}`,
    ).join('\n');
    return { name: title, path: `${slugish(title)}.feature`, content: `Feature: ${title}\n${scenarios}\n` };
  }

  private testCaseDrafts(title: string, count: number): { title: string; steps: string; data: string; expected: string; priority: 'MEDIUM' }[] {
    return Array.from({ length: count }, (_, i) => ({
      title: `${title} ${i + 1}`,
      steps: `1. Set up state ${i + 1}\n2. Perform action ${i + 1}`,
      data: '',
      expected: `The expected result ${i + 1} is observed`,
      priority: 'MEDIUM' as const,
    }));
  }
}

function result(input: string, text: string): BrainCompleteResult {
  return { text, usage: { inputTokens: input.length, outputTokens: text.length } };
}

/** Extracts the router's `{"classify": <text>}` payload; falls back to the raw message text. */
function classifyPayload(last: string): string {
  try {
    const v = JSON.parse(last) as { classify?: unknown };
    if (typeof v === 'object' && v !== null && typeof v.classify === 'string') return v.classify;
  } catch {
    /* raw text */
  }
  return last;
}

/** Keyword rules standing in for the real HAIKU classifier — first match wins, else low-confidence lead. */
const CLASSIFIER_RULES: readonly (readonly [RegExp, AgentSlot])[] = [
  [/\b(latenc\w*|p9\d|load|perf\w*|throughput|stress)\b/i, 'perf'],
  [/\b(secur\w*|vulnerab\w*|injection|xss|csrf|exploit|pentest\w*)\b/i, 'sec'],
  [/\b(accessib\w*|a11y|screen reader|wcag|contrast)\b/i, 'a11y'],
  [/\bandroid\b/i, 'android'],
  [/\b(ios|iphone|ipad)\b/i, 'ios'],
  [/\b(visual|pixel\w*|screenshot\w*)\b/i, 'visual'],
  [/\b(browser|e2e|selector\w*|playwright|cypress)\b/i, 'web'],
  [/\b(api|endpoint\w*|rest|contract\w*)\b/i, 'api'],
  [/\b(manual|exploratory)\b/i, 'manual'],
  [/\b(architect\w*|strategy|test plan)\b/i, 'arch'],
];

function classifyChat(text: string): { slot: AgentSlot; confidence: number } {
  for (const [re, slot] of CLASSIFIER_RULES) {
    if (re.test(text)) return { slot, confidence: 0.9 };
  }
  return { slot: 'lead', confidence: 0.3 };
}

/** Canned deterministic persona answers — one stable voice per slot. */
const CANNED: Record<AgentSlot, string> = {
  lead: 'Zeus here — I coordinate the pantheon. Tell me the goal and I will bring in the right specialist.',
  arch: 'Athena here — shape the strategy first: risks, test layers, and where each check belongs.',
  manual: 'Anubis here — chart the exploratory path: preconditions, charters, and the evidence to collect.',
  web: 'Quetzalcóatl here — drive the browser with resilient selectors and deterministic waits.',
  api: 'Iris here — pin the contract first: status codes, schemas and error envelopes, then automate.',
  android: 'Freya here — exercise the Android build across device profiles and lifecycle edges.',
  ios: 'Isis here — validate the iOS build across orientations, permissions and interruptions.',
  perf: 'Thor here — set a p95 budget, ramp the load with k6 and find the saturation knee.',
  visual: 'Xochiquetzal here — snapshot the critical states and diff pixels against the approved baseline.',
  sec: 'Odin here — threat-model the surface: injection, authz gaps and secrets handling come first.',
  a11y: 'Ra here — audit landmarks, contrast and keyboard paths; accessibility failures block release.',
};

/**
 * Whitelisted tool intents the stub can emit (mirrors the SendChatMessage tool contract): the real
 * brain decides tool use; the stub derives it deterministically from the message text.
 */
function toolIntent(text: string): Record<string, string> | null {
  const run = /run the (.+?) feature/i.exec(text);
  if (run) return { tool: 'enqueue_run', featureName: run[1]! };
  const tc = /create a test case for (.+)/i.exec(text);
  if (tc) return { tool: 'create_test_case', title: tc[1]!.trim().replace(/[.!?]+$/, '') };
  if (/\bgenerate\b[\s\S]*\bfeatures?\b/i.test(text)) return { tool: 'generate_feature', prompt: text };
  return null;
}

function chatAnswer(slot: AgentSlot, text: string): string {
  const intent = toolIntent(text);
  return intent ? JSON.stringify(intent) : CANNED[slot];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

function slugish(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'feature');
}
