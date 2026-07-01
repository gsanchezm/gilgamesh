-- Migrate subscription plans from the legacy 3-tier enum to the active-workspace 4-tier model.
-- Existing paid rows keep their relative tier position; new onboarding seeds FREE in application code.
ALTER TYPE "Plan" RENAME TO "Plan_old";

CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'SCALE');

ALTER TABLE "subscriptions"
  ALTER COLUMN "plan" TYPE "Plan"
  USING (
    CASE "plan"::text
      WHEN 'TEAM' THEN 'STARTER'::"Plan"
      WHEN 'PRO' THEN 'GROWTH'::"Plan"
      WHEN 'ENTERPRISE' THEN 'SCALE'::"Plan"
    END
  );

DROP TYPE "Plan_old";

UPDATE "subscriptions"
SET
  "run_minutes_quota" = CASE "plan"
    WHEN 'FREE' THEN 500
    WHEN 'STARTER' THEN 5000
    WHEN 'GROWTH' THEN 25000
    WHEN 'SCALE' THEN 1000000000
  END,
  "seats" = CASE
    WHEN "plan" = 'FREE' AND "seats" > 1 THEN 1
    ELSE "seats"
  END;
