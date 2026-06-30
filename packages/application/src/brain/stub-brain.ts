import { embedText } from '@gilgamesh/domain';
import type {
  AgentBrainPort,
  BrainCompleteRequest,
  BrainCompleteResult,
} from '../ports/brain';

/**
 * Deterministic, offline {@link AgentBrainPort} stub used in slice 2: it returns reproducible,
 * well-formed test-draft JSON derived from the request — no network, no randomness — so generation
 * is testable and the real Claude adapter can drop in later behind the same port. The draft JSON
 * shape is the contract owned by the GenerateDrafts use case.
 */
export class DeterministicBrain implements AgentBrainPort {
  async complete(req: BrainCompleteRequest): Promise<BrainCompleteResult> {
    const last = req.messages[req.messages.length - 1]?.content ?? '{}';
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

    const text = JSON.stringify(body);
    return { text, usage: { inputTokens: last.length, outputTokens: text.length } };
  }

  // stream/embed are part of the frozen port but unused by slice 2; provide trivial, non-throwing
  // implementations (the Brain slice supplies the real ones).
  async *stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }> {
    const { text } = await this.complete(req);
    yield { delta: text };
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Deterministic lexical-hash embedding (slice 5): real lexical similarity, offline. The real
    // semantic embeddings replace this with the Claude/embedding adapter in the Brain slice.
    return texts.map((t) => embedText(t));
  }

  private featureDraft(title: string, count: number): { name: string; path: string; content: string } {
    const scenarios = Array.from(
      { length: count },
      (_, i) =>
        `  Scenario: ${title} case ${i + 1}\n    Given a precondition\n    When action ${i + 1} happens\n    Then the expected outcome ${i + 1}`,
    ).join('\n');
    return { name: title, path: `${slugish(title)}.feature`, content: `Feature: ${title}\n${scenarios}\n` };
  }

  private testCaseDrafts(
    title: string,
    count: number,
  ): { title: string; steps: string; data: string; expected: string; priority: 'MEDIUM' }[] {
    return Array.from({ length: count }, (_, i) => ({
      title: `${title} ${i + 1}`,
      steps: `1. Set up state ${i + 1}\n2. Perform action ${i + 1}`,
      data: '',
      expected: `The expected result ${i + 1} is observed`,
      priority: 'MEDIUM' as const,
    }));
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

function slugish(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'feature'
  );
}
