import { scrubChunk } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { AgentBrainPort } from '../ports/brain';
import type {
  Citation,
  KnowledgeChunkRepository,
  KnowledgeRetrievalPort,
  RetrievedChunk,
  ScopedRetrievalFilter,
} from '../ports/knowledge';
import type { KnowledgeChunkRecord } from '../ports/records';

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

interface KnowledgeDeps {
  knowledge: KnowledgeChunkRepository;
  brain: AgentBrainPort;
}

/** Scrub → drop tiny → embed → upsert raw corpus chunks into the global shared KB (slice 5). */
export class IngestKnowledge {
  constructor(private readonly deps: KnowledgeDeps) {}

  async execute(chunks: RawChunk[]): Promise<{ ingested: number; skipped: number }> {
    const cleaned = chunks
      .map((c) => ({ chunk: c, content: scrubChunk(c.text) }))
      .filter((c) => tokenCount(c.content) >= MIN_TOKENS);
    if (cleaned.length === 0) return { ingested: 0, skipped: chunks.length };

    const embeddings = await this.deps.brain.embed(cleaned.map((c) => c.content));
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

  async execute(input: { query: string; k?: number }): Promise<SearchResultView> {
    const q = input.query.trim().slice(0, MAX_QUERY_CHARS);
    if (!q) throw new ApplicationError('VALIDATION', 'A query is required.');
    const k = Math.min(Math.max(Math.trunc(input.k ?? 8), 1), 20);
    const [embedding] = await this.deps.brain.embed([q]);
    if (isZeroVector(embedding)) return { results: [], total: await this.deps.knowledge.count() };
    const scored = await this.deps.knowledge.search(embedding!, k);
    return {
      results: scored.map((s) => ({ content: s.chunk.content, citation: citationOf(s.chunk), score: s.score })),
      total: await this.deps.knowledge.count(),
    };
  }
}

/** The {@link KnowledgeRetrievalPort} adapter `GenerateDrafts` consumes to ground generation. */
export class KnowledgeRetriever implements KnowledgeRetrievalPort {
  constructor(private readonly deps: KnowledgeDeps) {}

  async retrieve(query: string, k: number): Promise<RetrievedChunk[]> {
    const q = query.trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return [];
    const [embedding] = await this.deps.brain.embed([q]);
    if (isZeroVector(embedding)) return [];
    const scored = await this.deps.knowledge.search(embedding!, k);
    return scored.map((s) => ({ content: s.chunk.content, citation: citationOf(s.chunk), score: s.score }));
  }

  /** Slice-8 chat grounding: same pipeline over the chunks visible to one agent of one org. */
  async retrieveScoped(query: string, k: number, filter: ScopedRetrievalFilter): Promise<RetrievedChunk[]> {
    const q = query.trim().slice(0, MAX_QUERY_CHARS);
    if (!q) return [];
    const [embedding] = await this.deps.brain.embed([q]);
    if (isZeroVector(embedding)) return [];
    const scored = await this.deps.knowledge.searchScoped(filter, embedding!, k);
    return scored.map((s) => ({ content: s.chunk.content, citation: citationOf(s.chunk), score: s.score }));
  }
}
