-- AlterTable
ALTER TABLE "knowledge_chunks" ADD COLUMN     "document_id" UUID,
ADD COLUMN     "org_id" UUID;

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_org_id_created_at_idx" ON "knowledge_documents"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_chunks_org_id_idx" ON "knowledge_chunks"("org_id");

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
