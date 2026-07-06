// Cucumber-js config for the Slice 1 BDD acceptance suite (runs the frozen
// specs/slices/01-* feature files against the real Prisma/Postgres-wired API).
//
// TS step definitions are transpiled on the fly by @swc-node/register, which reads
// apps/api/tsconfig.json: module=CommonJS (so nested Nest imports resolve as require,
// honoring tsconfig `paths`) and experimentalDecorators/emitDecoratorMetadata (so the
// NestJS DI metadata survives). Do NOT set SWCRC=true — .swcrc has no module type and
// would default swc to ESM output, breaking extensionless module resolution.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public';
// Effectively disable the auth rate limit for the acceptance sweep (it re-registers the same
// user across dozens of scenarios); the 429 behavior is proven by a dedicated e2e instead.
process.env.AUTH_RATE_LIMIT = process.env.AUTH_RATE_LIMIT || '1000000';
// Slice 9: force the deterministic stub brain — the sweep never calls the network, even when the
// developer machine has ANTHROPIC_API_KEY set. Metering is unconditional (the application layer
// meters every brain call, stub included), so the metering scenarios observe stub usage rows.
process.env.BRAIN_MODE = process.env.BRAIN_MODE || 'offline';
// Slice 13: force the deterministic mock payment provider for the same reason — the sweep never
// calls stripe.com, even when the developer machine has STRIPE_SECRET_KEY set.
process.env.PAYMENTS_MODE = process.env.PAYMENTS_MODE || 'offline';
// Slice 15: the deterministic StubIdentityProvider answers the SSO routes — an EXPLICIT opt-in
// (missing Google env alone means "unconfigured", never the stub; see specs/slices/15-sso-google).
process.env.SSO_MODE = process.env.SSO_MODE || 'offline';
// Slice 17: force the recording mail stub — the sweep's auth-recovery scenarios read tokens out
// of recorded mail via TOKENS.Email and must never open an SMTP connection, even when the
// developer machine has SMTP_URL set.
process.env.EMAIL_MODE = process.env.EMAIL_MODE || 'offline';
// Slice 20: the in-memory secret-vault stub — an EXPLICIT opt-in (security inversion: the
// selector refuses to boot unconfigured, never a silent stub). The sweep must never reach
// Azure, even when the developer machine has AZURE_KEY_VAULT_URL set.
process.env.VAULT_MODE = process.env.VAULT_MODE || 'offline';

module.exports = {
  default: {
    requireModule: ['@swc-node/register'],
    require: ['acceptance/**/*.ts'],
    // All built slices' feature files (01-auth-onboarding-agent-room, 02-test-lab-authoring, …).
    paths: ['../../specs/slices/*/*.feature'],
    format: ['summary', 'progress'],
    // The default run covers only the built surface. Scenarios needing code not yet
    // in slice 1 are @wip; UI-only ones @ui (Playwright); fault-injection ones @manual.
    tags: 'not @wip and not @ui and not @manual and not @out-of-scope',
  },
};
