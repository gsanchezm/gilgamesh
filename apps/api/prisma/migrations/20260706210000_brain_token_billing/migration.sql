-- Slice 14 (keystone v0.6): per-plan AI Brain token allowance + usage on the subscription.
-- Billable tokens = input + output (cache read/create EXCLUDED); charged atomically per call
-- together with the BrainUsage row; quota exhausted -> QUOTA_EXCEEDED (402; narrated in chat).

-- The FREE default covers rows created between ADD COLUMN and the backfill (none in practice);
-- the application always writes the quota explicitly on create.
ALTER TABLE "subscriptions" ADD COLUMN "brain_tokens_quota" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "subscriptions" ADD COLUMN "brain_tokens_used" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing orgs per their current plan (keystone §9 allowances; SCALE is unlimited —
-- stored at the 1e9 cap, the derived brainTokensUnlimited flag is the real signal).
UPDATE "subscriptions" SET "brain_tokens_quota" = CASE "plan"
  WHEN 'FREE' THEN 100000
  WHEN 'STARTER' THEN 2000000
  WHEN 'GROWTH' THEN 10000000
  WHEN 'SCALE' THEN 1000000000
END;

-- Drop the bootstrap defaults so the schema stays explicit (parity with run_minutes_*).
ALTER TABLE "subscriptions" ALTER COLUMN "brain_tokens_quota" DROP DEFAULT;
ALTER TABLE "subscriptions" ALTER COLUMN "brain_tokens_used" DROP DEFAULT;
