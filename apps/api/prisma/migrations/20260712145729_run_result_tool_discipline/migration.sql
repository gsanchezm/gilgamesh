-- AlterTable
-- (keystone v0.7) per-result tool/discipline for the Reports per-tool breakdown; both nullable, no backfill.
-- NOTE: the `DROP INDEX knowledge_chunks_embedding_hnsw_idx` that `migrate dev` auto-adds here is a false
-- drift — that HNSW index is created via raw SQL Prisma doesn't model. It is intentionally removed so this
-- migration does not destroy the pgvector RAG index.
ALTER TABLE "run_results" ADD COLUMN     "discipline" TEXT,
ADD COLUMN     "tool" TEXT;
