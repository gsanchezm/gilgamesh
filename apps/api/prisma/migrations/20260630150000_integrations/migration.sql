-- Slice 6: source-repo integrations + the project's repo last-sync timestamp.
ALTER TABLE "projects" ADD COLUMN "repo_last_sync_at" TIMESTAMP(3);

CREATE TYPE "IntegrationGroup" AS ENUM ('SOURCE_REPOS', 'PROJECT_TRACKING', 'TEST_MANAGEMENT', 'COMMUNICATION', 'CICD', 'DEVICES_BROWSERS');

CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "group" "IntegrationGroup" NOT NULL,
    "connected" BOOLEAN NOT NULL,
    "secret_ref" TEXT,
    "config" JSONB NOT NULL,
    "connected_by_id" UUID,
    "connected_at" TIMESTAMP(3),

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integrations_org_id_key_key" ON "integrations"("org_id", "key");

ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
