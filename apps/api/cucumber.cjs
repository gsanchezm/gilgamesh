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

const FEATURES = '../../specs/slices/01-auth-onboarding-agent-room';

module.exports = {
  default: {
    requireModule: ['@swc-node/register'],
    require: ['acceptance/**/*.ts'],
    paths: [`${FEATURES}/*.feature`],
    format: ['summary', 'progress'],
    // The default run covers only the built surface. Scenarios needing code not yet
    // in slice 1 are @wip; UI-only ones @ui (Playwright); fault-injection ones @manual.
    tags: 'not @wip and not @ui and not @manual and not @out-of-scope',
  },
};
