-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectFormat" AS ENUM ('BDD', 'TRADITIONAL');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RepoProvider" AS ENUM ('github', 'gitlab', 'bitbucket', 'ado');

-- CreateEnum
CREATE TYPE "AgentSlot" AS ENUM ('lead', 'arch', 'manual', 'web', 'api', 'android', 'ios', 'perf', 'visual', 'sec', 'a11y');

-- CreateEnum
CREATE TYPE "AgentFamily" AS ENUM ('proceso', 'ui', 'backend', 'guardian');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TEAM', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "orgs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "format" "ProjectFormat" NOT NULL,
    "repo_provider" "RepoProvider",
    "repo_full_name" TEXT,
    "repo_branch" TEXT,
    "repo_commit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slices" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "slices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "slot" "AgentSlot" NOT NULL,
    "deity_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "family" "AgentFamily" NOT NULL,
    "glyph" TEXT NOT NULL,
    "culture" TEXT NOT NULL,
    "default_tool" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_bindings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "plan" "Plan" NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "run_minutes_quota" INTEGER NOT NULL,
    "run_minutes_used" INTEGER NOT NULL,
    "provider_customer_id" TEXT,
    "provider_subscription_id" TEXT,
    "current_period_end" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_slug_key" ON "projects"("org_id", "slug");

-- CreateIndex
CREATE INDEX "slices_org_id_idx" ON "slices"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "slices_project_id_key_key" ON "slices"("project_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "agents_org_id_slot_key" ON "agents"("org_id", "slot");

-- CreateIndex
CREATE INDEX "tool_bindings_org_id_idx" ON "tool_bindings"("org_id");

-- CreateIndex
CREATE INDEX "tool_bindings_agent_id_idx" ON "tool_bindings"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_bindings_project_id_agent_id_key" ON "tool_bindings"("project_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_org_id_key" ON "subscriptions"("org_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_created_at_idx" ON "audit_logs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slices" ADD CONSTRAINT "slices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slices" ADD CONSTRAINT "slices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_bindings" ADD CONSTRAINT "tool_bindings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_bindings" ADD CONSTRAINT "tool_bindings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_bindings" ADD CONSTRAINT "tool_bindings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
