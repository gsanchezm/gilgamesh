-- Audit #8 (batch C): ANN index for the knowledge cosine searches. The repository's inner
-- ANN scan orders by the bare `embedding <=> $q` expression precisely so the planner can walk
-- this index (a tie-break column in the ORDER BY would force a full sort and bypass it).
-- vector(1024) is within HNSW's 2000-dim limit; the docker image (pgvector/pgvector:pg16)
-- ships pgvector >= 0.5, which introduced HNSW.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
