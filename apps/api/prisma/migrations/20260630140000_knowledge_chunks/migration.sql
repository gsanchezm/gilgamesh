-- Slice 5: the GLOBAL shared knowledge base (owner decision S5-A) with pgvector embeddings.
-- No orgId — retrieval is shared across all orgs (the one place tenant isolation is deliberately relaxed).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "heading_path" TEXT[],
    "section" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "token_estimate" INTEGER NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);
