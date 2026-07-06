import type { AgentSlot } from '@gilgamesh/domain';
import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from './records';

export interface ScoredChunk {
  chunk: KnowledgeChunkRecord;
  score: number;
}

/** Visibility filter for per-agent chat retrieval (slice 8): the tenant + the answering agent's slot. */
export interface ScopedRetrievalFilter {
  orgId: string;
  slot: AgentSlot;
}

/** Persistence for knowledge chunks (pgvector in prod; in-memory cosine in tests). */
export interface KnowledgeChunkRepository {
  upsertMany(chunks: KnowledgeChunkRecord[]): Promise<void>;
  /** Cosine-similarity top-k over the GLOBAL shared corpus only (orgId IS NULL) — never per-org chunks. */
  search(queryEmbedding: number[], k: number): Promise<ScoredChunk[]>;
  /**
   * Cosine top-k over the chunks VISIBLE to one agent of one org (slice 8): the org's own chunks plus
   * the global shared corpus (orgId IS NULL), where `scope` = the agent's slot, `shared`, or NULL.
   */
  searchScoped(filter: ScopedRetrievalFilter, queryEmbedding: number[], k: number): Promise<ScoredChunk[]>;
  /** Size of the GLOBAL shared corpus (orgId IS NULL). */
  count(): Promise<number>;
}

/** Persistence for per-org uploaded knowledge documents (slice 7). */
export interface KnowledgeDocumentRepository {
  create(doc: KnowledgeDocumentRecord): Promise<void>;
  /** Newest-first, tenant-scoped to the org. */
  listForOrg(orgId: string): Promise<KnowledgeDocumentRecord[]>;
}

/** Source provenance for a retrieved chunk — always carried so generated artifacts are attributable (S5-D). */
export interface Citation {
  source: string;
  section: string;
  headingPath: string[];
}

export interface RetrievedChunk {
  content: string;
  citation: Citation;
  score: number;
}

/** The RAG grounding seam: `GenerateDrafts` consults this to ground generation in the shared KB (S5-C). */
export interface KnowledgeRetrievalPort {
  retrieve(query: string, k: number): Promise<RetrievedChunk[]>;
  /** Slice-8 chat grounding: same pipeline, restricted to the chunks visible to one agent of one org. */
  retrieveScoped(query: string, k: number, filter: ScopedRetrievalFilter): Promise<RetrievedChunk[]>;
}
