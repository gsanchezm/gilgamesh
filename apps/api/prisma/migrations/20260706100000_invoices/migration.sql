-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provider_invoice_id" TEXT,
    "status" "InvoiceStatus" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "hosted_invoice_url" TEXT,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_invoice_id_key" ON "invoices"("provider_invoice_id");

-- CreateIndex
CREATE INDEX "invoices_org_id_created_at_idx" ON "invoices"("org_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
