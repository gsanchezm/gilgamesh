-- Slice 16 / keystone v0.5 (BREAKING, owner-approved): KnowledgeChunk.embedding
-- vector(1536) -> vector(1024) for Voyage voyage-4 semantic embeddings (Voyage 4 has no 1536 option).
--
-- DESTRUCTIVE. 1536-dim vectors cannot be cast to 1024, so every stored embedding is destroyed:
--   1. All knowledge_chunks rows are deleted (the global shared corpus AND per-org uploads).
--   2. All knowledge_documents rows are deleted too — a document whose chunks were destroyed must
--      not linger reporting a stale chunkCount over zero chunks. Orgs re-upload their documents.
--   3. The column type is altered to vector(1024).
--
-- Re-ingest afterwards (spec 16 §9):
--   * The KnowledgeSeeder re-seeds the paraphrased sample corpus automatically at next boot
--     (its empty-KB check now passes).
--   * `pnpm --filter @gilgamesh/api ingest:corpus` re-loads the full rag/ corpus (~2,647 chunks) —
--     lexical offline by default; real Voyage embeddings when VOYAGE_API_KEY is set.
--   * Per-org uploaded documents must be re-uploaded by their orgs.

-- Chunks first (their document_id FK references knowledge_documents).
DELETE FROM "knowledge_chunks";
DELETE FROM "knowledge_documents";

-- AlterColumn (only valid while the table is empty)
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" TYPE vector(1024);
