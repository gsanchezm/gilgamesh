/**
 * Provider-agnostic LLM port (keystone §5). Slice 2 consumes only `complete` (for test-draft
 * generation) behind a deterministic stub; the real Claude adapter (tiering, prompt caching, BYOK,
 * token metering) and heavy use of `stream`/`embed` arrive in the Brain slice.
 */
export type BrainTier = 'HAIKU' | 'SONNET' | 'OPUS';

export interface BrainMessage {
  role: string;
  content: string;
}

export interface BrainCompleteRequest {
  tier: BrainTier;
  system: string;
  messages: BrainMessage[];
  cacheKey?: string;
}

export interface BrainCompleteResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentBrainPort {
  complete(req: BrainCompleteRequest): Promise<BrainCompleteResult>;
  stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }>;
  embed(texts: string[]): Promise<number[][]>;
}
