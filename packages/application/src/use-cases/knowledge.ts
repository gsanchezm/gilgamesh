import { scrubChunk } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import { hasEmbedAs, type AgentBrainPort, type BrainTier, type EmbeddingKind } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type {
  Citation,
  KnowledgeChunkRepository,
  KnowledgeRetrievalPort,
  RetrievedChunk,
  ScopedRetrievalFilter,
  ScoredChunk,
} from '../ports/knowledge';
import type { KnowledgeChunkRecord } from '../ports/records';
import type { BrainUsageRepository } from '../ports/repositories';

const MIN_TOKENS = 4; // drop near-empty boilerplate-only chunks (e.g. a stray page number) after scrubbing
const MAX_QUERY_CHARS = 512; // a search query never needs more; bounds work on hostile input

export interface RawChunk {
  id: string;
  source: string;
  headingPath: string[];
  section: string;
  text: string;
  tokenEstimate?: number;
}

function tokenCount(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}

/**
 * A query with no embeddable [a-z0-9] tokens (e.g. "!!!", punctuation/CJK-only) embeds to an all-zero
 * vector. Cosine against a zero vector is undefined — in-memory yields 0, but pgvector's `<=>` yields NaN
 * (→ `score:null` + arbitrary order). Detect it up front and return nothing, so both wirings agree.
 */
function isZeroVector(v: number[] | undefined): boolean {
  return !v || v.every((x) => x === 0);
}

function citationOf(chunk: KnowledgeChunkRecord): Citation {
  return { source: chunk.source, section: chunk.section, headingPath: chunk.headingPath };
}

/** Optional S16 EMBED-metering deps (keystone v0.3 `BrainUsage`); absent → embeds are unmetered. */
export interface EmbedMeter {
  brainUsage: BrainUsageRepository;
  ids: IdGenerator;
  clock: Clock;
}

/** Embeddings have no generation tier; EMBED rows pin the nominal lightest tier (the ROUTER-at-HAIKU
 *  precedent) until the keystone ever grows an embedding member on the frozen `BrainTier` (spec 16 §6). */
export const EMBED_TIER: BrainTier = 'HAIKU';

/**
 * Embed via the optional kind-aware S16 extension when the adapter has it (Voyage `input_type` +
 * provider token counts), else through the frozen `embed()` (kind lost → the provider default
 * `document` semantics; usage unknown → 0). Spec 16 AC-EMB-04.
 */
export async function embedFor(
  brain: AgentBrainPort,
  texts: string[],
  kind: EmbeddingKind,
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  if (hasEmbedAs(brain)) {
    const res = await brain.embedAs(texts, kind);
    return { embeddings: res.embeddings, totalTokens: res.usage.totalTokens };
  }
  return { embeddings: await brain.embed(texts), totalTokens: 0 };
}

/**
 * One `BrainUsage` row per embed call (surface `EMBED`, outputTokens 0). No-op without a meter or an
 * orgId (`BrainUsage.orgId` is frozen non-null — platform-global ingest has no tenant to attribute,
 * spec 16 AC-EMB-06). A metering failure is swallowed: it must NEVER break ingest/search/grounding.
 */
export async function meterEmbed(
  meter: EmbedMeter | undefined,
  orgId: string | null | undefined,
  totalTokens: number,
): Promise<void> {
  if (!meter || !orgId) return;
  try {
    await meter.brainUsage.append({
      id: meter.ids.next(),
      orgId,
      tier: EMBED_TIER,
      surface: 'EMBED',
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      createdAt: meter.clock.now(),
    });
  } catch {
    /* metering must never fail the user call (spec 16 AC-EMB-05) */
  }
}

interface KnowledgeDeps {
  knowledge: KnowledgeChunkRepository;
  brain: AgentBrainPort;
  meter?: EmbedMeter;
}

/** Scrub → drop tiny → embed → upsert raw corpus chunks into the global shared KB (slice 5). */
export class IngestKnowledge {
  constructor(private readonly deps: KnowledgeDeps) {}

  /** `attribution.orgId` meters the embed cost to a tenant; the global corpus paths pass none (AC-EMB-06). */
  async execute(chunks: RawChunk[], attribution?: { orgId: string }): Promise<{ ingested: number; skipped: number }> {
    const cleaned = chunks
      .map((c) => ({ chunk: c, content: scrubChunk(c.text) }))
      .filter((c) => tokenCount(c.content) >= MIN_TOKENS);
    if (cleaned.length === 0) return { ingested: 0, skipped: chunks.length };

    const { embeddings, totalTokens } = await embedFor(this.deps.brain, cleaned.map((c) => c.content), 'document');
    await meterEmbed(this.deps.meter, attribution?.orgId, totalTokens);
    const records: KnowledgeChunkRecord[] = cleaned.map((c, i) => ({
      id: c.chunk.id,
      source: c.chunk.source,
      headingPath: c.chunk.headingPath,
      section: c.chunk.section,
      content: c.content,
      embedding: embeddings[i]!,
      tokenEstimate: c.chunk.tokenEstimate ?? tokenCount(c.content),
    }));
    await this.deps.knowledge.upsertMany(records);
    return { ingested: records.length, skipped: chunks.length - records.length };
  }
}

export interface SearchResultView {
  results: { content: string; citation: Citation; score: number }[];
  total: number;
}

/** Embed the query → cosine top-k over the shared KB → results with source citations (S5-D). */
export class SearchKnowledge {
  constructor(private readonly deps: KnowledgeDeps) {}

  /** `orgId` only ATTRIBUTES the EMBED metering (S16) — the search itself stays global (S5-A). */
  async execute(input: { query: string; k?: number; orgId?: string }): Promise<SearchResultView> {
    const q = input.query.trim().slice(0, MAX_QUERY_CHARS);
    if (!q) throw new ApplicationError('VALIDATION', 'A query is required.');
    const k = Math.min(Math.max(Math.trunc(input.k ?? 8), 1), 20);
    const { embeddings: [embedding], totalTokens } = await embedFor(this.deps.brain, [q], 'query');
    await meterEmbed(this.deps.meter, input.orgId, totalTokens);
    if (isZeroVector(embedding)) return { results: [], total: await this.deps.knowledge.count() };
    const scored = await this.deps.knowledge.search(embedding!, k);
    return {
      results: scored.map((s) => ({ content: s.chunk.content, citation: citationOf(s.chunk), score: s.score })),
      total: await this.deps.knowledge.count(),
    };
  }
}

/** Renders retrieved chunks into the grounding block shared by GenerateDrafts and chat (review S8). */
export function formatGrounding(retrieved: RetrievedChunk[]): string {
  return retrieved.map((r) => `[${r.citation.source}] ${r.content}`).join('\n\n');
}

/** The {@link KnowledgeRetrievalPort} adapter `GenerateDrafts` consumes to ground generation. */
export class KnowledgeRetriever implements KnowledgeRetrievalPort {
  constructor(private readonly deps: KnowledgeDeps) {}

  retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
    // No org in scope — unmetered by design (BrainUsage.orgId is frozen non-null, spec 16 AC-EMB-06).
    return this.ground(query, undefined, (embedding) => this.deps.knowledge.search(embedding, k));
  }

  /** Slice-8 chat grounding: same pipeline over the chunks visible to one agent of one org. */
  retrieveScoped(query: string, k: number, filter: ScopedRetrievalFilter): Promise<RetrievedChunk[]> {
    return this.ground(query, filter.orgId, (embedding) => this.deps.knowledge.searchScoped(filter, embedding, k));
  }

  /** One grounding pipeline for both paths: trim/cap → embed (+meter) → zero-vector guard → cite. */
  private async ground(
    query: string,
    orgId: string | undefined,
    search: (embedding: number[]) => Promise<ScoredChunk[]>,
  ): Promise<RetrievedChunk[]> {
    const q = query.trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return [];
    const { embeddings: [embedding], totalTokens } = await embedFor(this.deps.brain, [q], 'query');
    await meterEmbed(this.deps.meter, orgId, totalTokens);
    if (isZeroVector(embedding)) return [];
    const scored = await search(embedding!);
    return scored.map((s) => ({ content: s.chunk.content, citation: citationOf(s.chunk), score: s.score }));
  }
}
