// Billing-period usage ROLLOVER (slice 21, closes owner note S14-6). Resets BOTH Subscription usage
// counters — run_minutes_used (execution minutes) AND brain_tokens_used (AI tokens) — to zero
// TOGETHER in one atomic statement, so the next period's quota gates start from a clean tally. It
// touches only those two counters; plan/quotas/status and every other column are untouched, and the
// immutable BrainUsage / Invoice ledgers are never modified. Idempotent; a no-op when nothing
// matches. Operator-/cron-triggered — there is deliberately no HTTP surface (owner decision S21-C).
//
//   DATABASE_URL=postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public \
//     node apps/api/scripts/rollover-billing.mjs                 # every org
//   DATABASE_URL=... node apps/api/scripts/rollover-billing.mjs --org <orgId>   # one org
//
// Or via the workspace script: `pnpm --filter @gilgamesh/api rollover:billing [-- --org <orgId>]`.
//
// The SQL below is the SAME statement as PrismaSubscriptionRepository.resetUsage (identical
// columns/values/predicate; only template-literal indentation differs) — this operator script can't
// import the compiled TS adapter (the ingest-corpus.mjs duplication precedent). Any semantic
// divergence would be a money bug.
import { PrismaClient } from '@prisma/client';

/** Parse an optional `--org <id>` flag; undefined = reset every subscription. */
function parseOrgArg(argv) {
  const i = argv.indexOf('--org');
  if (i === -1) return undefined;
  const val = argv[i + 1];
  if (!val || val.startsWith('--')) {
    throw new Error('--org requires an organization id, e.g. --org 018f...');
  }
  return val;
}

async function main() {
  const orgId = parseOrgArg(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    // $executeRaw returns the affected-row count. Both counters reset TOGETHER (S14-6) in one
    // atomic UPDATE — never one without the other. The tagged template parameterizes orgId safely.
    const affected =
      orgId === undefined
        ? await prisma.$executeRaw`
            UPDATE subscriptions SET run_minutes_used = 0, brain_tokens_used = 0`
        : await prisma.$executeRaw`
            UPDATE subscriptions SET run_minutes_used = 0, brain_tokens_used = 0
            WHERE org_id = ${orgId}::uuid`;
    console.log(
      orgId === undefined
        ? `Billing rollover: reset both usage counters for ${affected} subscription(s).`
        : `Billing rollover: reset both usage counters for org ${orgId} (${affected} row(s)).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
