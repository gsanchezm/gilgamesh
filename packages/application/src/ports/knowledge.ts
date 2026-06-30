import type { KnowledgeChunkRecord } from './records';

export interface ScoredChunk {
  chunk: KnowledgeChunkRecord;
  score: number;
}

/** Persistence for the global shared knowledge base (pgvector in prod; in-memory cosine in tests). */
export interface KnowledgeChunkRepository {
  upsertMany(chunks: KnowledgeChunkRecord[]): Promise<void>;
  /** Cosine-similarity top-k over the whole shared collection. */
  search(queryEmbedding: number[], k: number): Promise<ScoredChunk[]>;
  count(): Promise<number>;
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
