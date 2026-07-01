# Repository Guidelines (for AI coding agents)

Gilgamesh is a multi-tenant QA platform (TypeScript monorepo: pnpm + Turborepo). Start with
[`README.md`](README.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) — they are authoritative for humans and
agents alike. This file is the quick brief.

## Project structure

- `packages/domain` — pure business logic, **zero framework imports** (enforced by lint + a fitness test).
- `packages/application` — use cases + **ports** (interfaces) + in-memory adapters/test doubles.
- `packages/ui` — React design-system components.
- `apps/api` — NestJS controllers + Prisma/Postgres adapters + deterministic stubs (`prisma/` = schema).
- `apps/web` — Vite + React screens calling the API through typed client ports.
- `specs/_keystone/foundation-vocabulary.md` — the **frozen** source of truth for names/enums/ports/paths.
- `specs/slices/<NN>/` — one folder per feature: the SDD `spec.md` + Gherkin `.feature` acceptance files.
- `docs/conventions/` + `docs/research/decisions-log.md` — methodology, gates, and every owner decision.
- `docs/research/feature-status.md` — the live product board (shipped vs. in-progress vs. blocked; as-built
  slice 7 = the *Look & feel* re-skin). Slices 1–6 are on `main`; slice 7 + audit fixes on `feat/look-and-feel`.

## Build, test & dev commands

```bash
pnpm install                                   # bootstrap
docker compose up -d postgres redis            # local Postgres 16 (pgvector) + Redis
pnpm --filter @gilgamesh/api db:deploy         # apply migrations
pnpm -r typecheck && pnpm lint && pnpm -r test # type-check, lint (incl. boundaries), unit tests (no Docker)
pnpm --filter @gilgamesh/api test:int          # integration vs real Postgres + Redis
pnpm --filter @gilgamesh/api test:bdd          # BDD acceptance (Cucumber) vs the real API + DB
pnpm --filter @gilgamesh/web test:e2e          # Playwright browser tests
pnpm --filter @gilgamesh/api start:dev         # run the API (needs DATABASE_URL, REDIS_URL — see README)
pnpm --filter @gilgamesh/web dev               # run the web dev server
```

## Non-negotiable conventions

- **Methodology:** every feature is **SDD → BDD → TDD** (spec → Gherkin → failing test → green → refactor).
  Never write production code without a failing test first.
- **Clean Architecture:** dependencies point inward only; the domain imports no framework. Business logic lives
  in `application` use cases that depend only on ports.
- **Names are frozen:** use entity/enum/port/path names verbatim from the keystone. New names = a recorded
  decision in `docs/research/decisions-log.md`.
- **Tenant isolation:** every query is `orgId`-scoped; a non-member gets `NOT_FOUND` (never `403`).
- **Secrets:** stored as vault references, never raw. External/AI services (Brain, TestKernel, PaymentProvider,
  RepoProvider) are **ports with deterministic stubs** today — always call through the port, never the network.

## Coding style

TypeScript throughout. Prettier + ESLint are configured and enforced (`pnpm lint`, `pnpm format`). Match the
surrounding code's idiom, comment density and naming. Keep generated files (Prisma client, build output) out of
source.

## Commits & PRs

Branch per feature (`slice-N-...`, `fix/...`); never commit to `main` directly. Small, green commits with
conventional prefixes (`feat(api): …`, `fix(domain): …`, `test(web): …`, `docs: …`). Before "done":
typecheck + lint + tests green, plus the Docker suites for API changes. CI (lint/typecheck/test +
integration/BDD + Playwright + CodeQL + secret-scan) must be green to merge.

## Agent-specific

There is detailed Claude-specific guidance in [`CLAUDE.md`](CLAUDE.md) (per-slice status, env quirks). Verify
file/symbol/command references against the current tree before acting — the codebase evolves.
