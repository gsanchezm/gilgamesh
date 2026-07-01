-- Purge pre-existing orphaned per-org chunks so the new FKs can be added (these are audit #1 artifacts:
-- chunks left behind when a document/org write failed). Global corpus rows (org_id/document_id NULL) are kept.
DELETE FROM "knowledge_chunks"
 WHERE ("document_id" IS NOT NULL AND "document_id" NOT IN (SELECT "id" FROM "knowledge_documents"))
    OR ("org_id" IS NOT NULL AND "org_id" NOT IN (SELECT "id" FROM "orgs"));

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_org_id_document_id_idx" ON "knowledge_chunks"("org_id", "document_id");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
