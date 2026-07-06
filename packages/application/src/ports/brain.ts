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
