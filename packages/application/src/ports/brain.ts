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
  /** Cache fields are an additive S9 extension (spec 09 s13): absent/0 for adapters without caching. */
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreateTokens?: number };
}

export interface AgentBrainPort {
  complete(req: BrainCompleteRequest): Promise<BrainCompleteResult>;
  stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }>;
  embed(texts: string[]): Promise<number[][]>;
}

/** Keystone v0.3 `BrainSurface` — where a brain call originated (the metering dimension). */
export type BrainSurface = 'CHAT' | 'ROUTER' | 'GENERATE' | 'EMBED';

export interface BrainStreamWithUsage {
  events: AsyncIterable<{ delta: string }>;
  usage: Promise<{ inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreateTokens?: number }>;
}

/**
 * OPTIONAL slice-9 extension (spec 09 s13): the frozen `stream()` yields only deltas, so an
 * adapter that knows its final usage exposes it here; `SendChatMessage` feature-detects it for
 * CHAT metering. Folded into the port at the next keystone major.
 */
export interface UsageReportingBrain {
  streamWithUsage(req: BrainCompleteRequest): BrainStreamWithUsage;
}

export function hasStreamWithUsage(brain: AgentBrainPort): brain is AgentBrainPort & UsageReportingBrain {
  return typeof (brain as { streamWithUsage?: unknown }).streamWithUsage === 'function';
}

/**
 * OPTIONAL slice-9 extension (spec 09 s13 — the `streamWithUsage` precedent): a composing adapter that
 * can resolve a per-org brain at call time (org BYOK key → platform key → stub) exposes `forOrg`;
 * `SendChatMessage` and `GenerateDrafts` feature-detect it via {@link hasBrainForOrg} and route their
 * completes/streams through the org-scoped instance. Consumer deps stay `AgentBrainPort` — adapters
 * without the extension (the deterministic stub) keep the direct path. Folded into the port at the
 * next keystone major.
 */
export interface OrgScopedBrain {
  forOrg(orgId: string): AgentBrainPort;
}

export function hasBrainForOrg(brain: AgentBrainPort): brain is AgentBrainPort & OrgScopedBrain {
  return typeof (brain as { forOrg?: unknown }).forOrg === 'function';
}

/** S16: what the texts are being embedded FOR — Voyage `input_type` (retrieval question vs stored corpus). */
export type EmbeddingKind = 'query' | 'document';

export interface EmbedWithUsageResult {
  embeddings: number[][];
  /** Provider-counted total tokens for the batch (Voyage `usage.total_tokens`); the stub reports a
   *  deterministic whitespace-token estimate so offline EMBED metering still carries real counts. */
  usage: { totalTokens: number };
}

/**
 * OPTIONAL slice-16 extension (spec 16 §5 — the `streamWithUsage`/`forOrg` precedent): the frozen
 * `embed()` takes only texts and returns only vectors, so an adapter that distinguishes query vs
 * document embeddings (Voyage `input_type`) and knows its token usage exposes `embedAs`. The
 * knowledge pipeline feature-detects it via {@link hasEmbedAs}, defaulting to `document`; adapters
 * without the extension keep working through the frozen `embed()`. Folded into the port at the
 * next keystone major.
 */
export interface KindAwareEmbeddingBrain {
  embedAs(texts: string[], kind: EmbeddingKind): Promise<EmbedWithUsageResult>;
}

export function hasEmbedAs(brain: AgentBrainPort): brain is AgentBrainPort & KindAwareEmbeddingBrain {
  return typeof (brain as { embedAs?: unknown }).embedAs === 'function';
}
