// Billing-period usage ROLLOVER (slice 21, closes owner note S14-6). Resets BOTH Subscription usage
// counters — run_minutes_used (execution minutes) AND brain_tokens_used (AI tokens) — to zero
// TOGETHER in one atomic statement, so the next period's quota gates start from a clean tally. It
// touches only those two counters; plan/quotas/status and every other column are untouched, and the
// immutable BrainUsage / Invoice ledgers are never modified. Idempotent; a no-op when nothing
// matches. Operator-/cron-triggered — there is deliberately no HTTP surface (owner decision S21-C).
//
//   DATABASE_URL=postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public \
//     node apps/api/scripts/rollover-billing.mjs --all              # every org (EXPLICIT)
//   DATABASE_URL=... node apps/api/scripts/rollover-billing.mjs --org <orgId>   # one org
//
// Or via the workspace script: `pnpm --filter @gilgamesh/api rollover:billing -- --all` (or `--org <id>`).
//
// The all-orgs path requires an EXPLICIT `--all` (review F2): a forgotten `--org` on a manual money
// tool would otherwise silently zero every tenant's usage for the whole period. A cron caller passes
// `--all` once; a human can no longer nuke all tenants by omission.
//
// The SQL below is the SAME statement as PrismaSubscriptionRepository.resetUsage (identical
// columns/values/predicate; only template-literal indentation differs) — this operator script can't
// import the compiled TS adapter (the ingest-corpus.mjs duplication precedent). Any semantic
// divergence would be a money bug; the int-test smoke shells THIS script to guard against drift.
import { PrismaClient } from '@prisma/client';

/**
 * Parse the target: `--org <id>` resets one org; `--all` resets every subscription. Exactly one is
 * required — a bare invocation is refused so a forgotten `--org` can't zero the whole platform (F2).
 * Returns the orgId, or `undefined` for the (explicitly-requested) all-orgs reset.
 */
function parseTarget(argv) {
  const all = argv.includes('--all');
  const i = argv.indexOf('--org');
  const org = i === -1 ? undefined : argv[i + 1];
  if (i !== -1 && (!org || org.startsWith('--'))) {
    throw new Error('--org requires an organization id, e.g. --org 018f...');
  }
  if (org && all) {
    throw new Error('Pass either --org <id> or --all, not both.');
  }
  if (!org && !all) {
    throw new Error(
      'Refusing to reset billing usage for EVERY tenant by default. ' +
        'Pass --all to reset all orgs, or --org <id> to reset one.',
    );
  }
  return org;
}

async function main() {
  const orgId = parseTarget(process.argv.slice(2));
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
  const msg = err instanceof Error ? err.message : String(err);
  // Scrub any postgres credentials Prisma may echo into a connection error — no DSN in operator logs (F4).
  console.error(msg.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1***@'));
  process.exit(1);
});
