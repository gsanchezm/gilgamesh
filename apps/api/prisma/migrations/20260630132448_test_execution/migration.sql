-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULE', 'CI');

-- CreateEnum
CREATE TYPE "RunTargetKind" AS ENUM ('FEATURE', 'TESTCASE');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PASS', 'FAIL', 'SKIP');

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "RunStatus" NOT NULL,
    "trigger" "RunTrigger" NOT NULL,
    "target_kind" "RunTargetKind" NOT NULL,
    "target_id" UUID NOT NULL,
    "run_label" TEXT,
    "passed" INTEGER,
    "failed" INTEGER,
    "skipped" INTEGER,
    "total" INTEGER,
    "rate_pct" INTEGER,
    "duration_ms" INTEGER,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_results" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "ref_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "log" TEXT[],
    "order" INTEGER NOT NULL,

    CONSTRAINT "run_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runs_project_id_created_at_idx" ON "runs"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "runs_org_id_idx" ON "runs"("org_id");

-- CreateIndex
CREATE INDEX "run_results_run_id_idx" ON "run_results"("run_id");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_results" ADD CONSTRAINT "run_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
