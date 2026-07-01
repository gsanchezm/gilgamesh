import type { KnowledgeChunkRecord, KnowledgeDocumentRecord } from './records';

export interface ScoredChunk {
  chunk: KnowledgeChunkRecord;
  score: number;
}

/** Persistence for knowledge chunks (pgvector in prod; in-memory cosine in tests). */
export interface KnowledgeChunkRepository {
  upsertMany(chunks: KnowledgeChunkRecord[]): Promise<void>;
  /** Cosine-similarity top-k over the GLOBAL shared corpus only (orgId IS NULL) — never per-org chunks. */
  search(queryEmbedding: number[], k: number): Promise<ScoredChunk[]>;
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
}
