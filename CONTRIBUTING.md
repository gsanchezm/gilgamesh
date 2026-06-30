# Contributing to Gilgamesh

Welcome! This guide gets you from "I cloned the repo" to "I shipped a feature the way this project expects."
Read [`README.md`](README.md) first (what the app is + how to run it), then this.

---

## The one rule that explains everything: SDD → BDD → TDD

Every feature is built in this order, **spec first, code last**:

1. **SDD — Spec-Driven Design.** Write the spec before the code. What are the acceptance criteria?
   → `specs/slices/<NN-feature>/spec.md`.
2. **BDD — Behaviour-Driven Development.** Express each acceptance criterion as an executable Gherkin scenario.
   → `specs/slices/<NN-feature>/<feature>.feature` + step definitions in `apps/api/acceptance/steps/`.
3. **TDD — Test-Driven Development.** For every unit of logic: **write the failing test, watch it fail, write
   the minimal code to pass, refactor.** Never write production code without a failing test first.

If you skip a step, you're not following the project. The full rationale is in
[`docs/conventions/engineering-methodology.md`](docs/conventions/engineering-methodology.md).

---

## The architecture in one picture

```
              depends on ───────────►
   web ──► (typed client ports) ──► api ──► application ──► domain
                                     │            │            ▲
                                     └─ adapters ─┴── ports ───┘
   Dependencies point INWARD only. domain depends on nothing.
```

- **`packages/domain`** — pure logic. **No framework imports, ever.** (A lint rule + a fitness test enforce
  this.) Entities, value objects, the agent roster, the Gherkin parser, RAG math.
- **`packages/application`** — **use cases** (the business operations) + **ports** (interfaces like
  `ProjectRepository`, `AgentBrainPort`, `PaymentProvider`). A use case depends only on ports — never on
  NestJS, Prisma, or HTTP.
- **`apps/api`** — **adapters**: NestJS controllers (HTTP → use case), Prisma repositories (port → Postgres),
  and the deterministic stubs. This is the only layer that knows about frameworks.
- **`apps/web`** — React screens that call the API through typed client "ports".

**Why this matters to you:** business logic is written **once**, in `application`, and tested without a
database or a browser. The same use case runs against in-memory fakes (fast tests) and Postgres (production)
with no changes.

### Two non-negotiable conventions

- **Names come from the keystone, verbatim.** Entity, enum, port and API-path names are frozen in
  [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md). If it's not there
  and you need a new name, that's a deliberate decision — record it in `docs/research/decisions-log.md`.
- **Tenant isolation is sacred.** Every query is scoped by `orgId`. A user who isn't a member of an Org must
  get **`NOT_FOUND`** (never `403`) — so we never leak that an Org/Project even exists across tenants. The
  gate lives in the use cases (e.g. `requireProjectAccess`).
- **Secrets are never stored raw.** Tokens/keys are stored as *vault references*, never the secret itself.

---

## The "stub port" pattern (read this before you touch the AI features)

Four capabilities are external/AI services: the LLM **Brain**, the **TestKernel** runtime, the
**PaymentProvider**, and the **RepoProvider**. Each is a **port** (interface) with a **deterministic, offline
stub** as today's implementation (`DeterministicBrain`, `DeterministicKernel`, `MockPaymentProvider`,
`MockRepoProvider`). Stubs return reproducible results with no network — that's why the whole app is testable.
When the real service is ready, it drops in **behind the same port**, and nothing else changes. **Don't call a
network/AI service directly from a use case — always go through the port.**

---

## How to add a feature (step by step)

Say you're adding "feature X". Branch first:

```bash
git checkout -b slice-7-feature-x   # never commit straight to main
```

1. **Spec it.** Create `specs/slices/07-feature-x/spec.md` with acceptance criteria (`AC-X-01`, `AC-X-02`, …).
   Check the keystone for the names/ports/paths you'll use.
2. **Domain (TDD).** If there's pure logic, write `packages/domain/src/<area>/<thing>.test.ts` first, watch it
   fail (`pnpm --filter @gilgamesh/domain test`), then implement `<thing>.ts`. Export it from the package index.
3. **Application (TDD).** Define the port(s) in `packages/application/src/ports/`, add the use case in
   `src/use-cases/` with its test, and add an in-memory adapter in `src/testing/in-memory.ts`. Run
   `pnpm --filter @gilgamesh/application test`.
4. **API.** Add the Prisma model + a migration (`apps/api/prisma/`), implement the Prisma adapter, **bind the
   port token in BOTH persistence wirings** (`persistence.module.ts` and `prisma/prisma-persistence.module.ts`),
   add the controller + DTOs + a module, register the module in `app.module.ts`, and add an e2e test in
   `apps/api/test/`. Run `pnpm --filter @gilgamesh/api test`.
5. **Web.** Add a typed client in `apps/web/src/lib/`, a screen in `src/screens/`, a route in
   `src/app/AppRoutes.tsx`, and tests. Run `pnpm --filter @gilgamesh/web test`.
6. **BDD.** Write `specs/slices/07-feature-x/feature-x.feature` + steps in `apps/api/acceptance/steps/`; if you
   added a new NestJS module, register it in `apps/api/acceptance/support/hooks.ts`. Run
   `pnpm --filter @gilgamesh/api test:bdd`.
7. **Playwright.** Add a browser test in `apps/web/e2e/`. Run `pnpm --filter @gilgamesh/web test:e2e`.
8. **Green everything**, then open a PR / merge (see below).

A good model to copy: look at how an existing slice did it end-to-end (e.g. slice 6 "Integrations" — search for
`integrations` across `packages/` and `apps/`).

---

## Running & debugging tests

| Command | What it checks | Needs Docker? |
|---------|----------------|---------------|
| `pnpm -r test` | all unit/component tests | no |
| `pnpm -r typecheck` | types across every package | no |
| `pnpm lint` | ESLint + architecture boundaries | no |
| `pnpm --filter @gilgamesh/api test:int` | use cases vs real Postgres + Redis | **yes** |
| `pnpm --filter @gilgamesh/api test:bdd` | acceptance scenarios vs the real API + DB | **yes** |
| `pnpm --filter @gilgamesh/web test:e2e` | browser flows vs the running stack | **yes** |

- A single file: `pnpm --filter @gilgamesh/api test -- <filename>`.
- Watch mode while developing: `pnpm --filter @gilgamesh/api test:watch`.
- The Docker-backed suites (`test:int`, `test:bdd`) **truncate the database** between scenarios — don't run
  them against data you care about.

---

## Commits, branches, and shipping

- **Branch per feature** (`slice-N-...` or `fix/...`), never commit to `main` directly.
- **Small, green commits.** Each commit should leave the tests passing. Conventional-commit style
  (`feat(api): …`, `fix(domain): …`, `test(web): …`, `docs: …`).
- **Before you say "done":** `pnpm -r typecheck && pnpm lint && pnpm -r test` all green, plus the Docker
  suites for anything touching the API. CI runs all of it again (ESLint boundaries · typecheck · tests ·
  integration/BDD on Postgres+Redis · Playwright · CodeQL · secret-scan) and must be green to merge.
- **Get it reviewed.** Every slice in this repo went through an adversarial review that found real bugs before
  merge — assume yours has bugs too, and look for them.

---

## Common gotchas (especially on Windows)

- **Login fails after running `test:int`/`test:bdd`?** Those suites truncate the `users` table. Re-register
  your account through the UI, or re-create the demo user (`demo@example.com` / `Demo-Passw0rd!`) via the
  register + onboarding endpoints.
- **`prisma generate` fails with `EPERM`/file-lock?** A running API process holds the Prisma engine DLL. Stop
  the API server (free port 3001), then re-run `pnpm --filter @gilgamesh/api prisma:generate`.
- **Ports already in use (3001/5173)?** A previous dev server is still running. Stop it before starting a new
  one.
- **`docker` not found?** See the Windows note in the README's Quick start.

---

## Where the rules are written down

- **Methodology (SDD→BDD→TDD):** [`docs/conventions/engineering-methodology.md`](docs/conventions/engineering-methodology.md)
- **Monorepo & dependency boundaries:** [`docs/conventions/monorepo.md`](docs/conventions/monorepo.md)
- **CI & quality gates:** [`docs/conventions/ci-and-quality-gates.md`](docs/conventions/ci-and-quality-gates.md)
- **The frozen contract:** [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md)
- **Architecture in depth:** [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Every decision & slice outcome:** [`docs/research/decisions-log.md`](docs/research/decisions-log.md)

Thanks for building with us. 🏛️
