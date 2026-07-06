-- CreateEnum
CREATE TYPE "BrainTier" AS ENUM ('HAIKU', 'SONNET', 'OPUS');

-- CreateEnum
CREATE TYPE "BrainSurface" AS ENUM ('CHAT', 'ROUTER', 'GENERATE', 'EMBED');

-- AlterEnum
ALTER TYPE "IntegrationGroup" ADD VALUE 'AI_PROVIDERS';

-- CreateTable
CREATE TABLE "brain_usage" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "tier" "BrainTier" NOT NULL,
    "surface" "BrainSurface" NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "cache_create_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_usage_org_id_created_at_idx" ON "brain_usage"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "brain_usage" ADD CONSTRAINT "brain_usage_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
