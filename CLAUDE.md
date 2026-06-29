# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Gilgamesh** — a multi-tenant web+mobile QA platform where 11 AI agents (each a mythological deity)
plan, author and run software tests, collaborate on a DAG orchestration canvas, and keep all results
in-app. Dark mode by default, English-only (no i18n). Execution runtime = the owner's TOM microkernel +
Atomic-Helix-Model (consumed as a dependency; real test execution from day 1, behind the `TestKernel` port).

Design source of truth: Claude Design project `ad397295-…` (read via the DesignSync MCP). The canonical
extract is `docs/research/gilgamesh-prototype-extract.md`; locked decisions are in
`docs/research/decisions-log.md`; the frozen contract vocabulary is `specs/_keystone/foundation-vocabulary.md`.

## Methodology (non-negotiable)

Every vertical slice is driven **SDD → BDD → TDD**: spec in `/specs` → Gherkin `.feature` → failing unit
tests → green → refactor. Clean Architecture with ports & adapters; dependencies point inward only
(domain has zero framework imports). Performance and security are first-class (per-`orgId` tenant
isolation on every query, secrets as vault refs, OWASP ASVS L2 target). Favor small, reviewable increments.

## Commands

```bash
pnpm install                                   # bootstrap the workspace (pnpm + Turborepo)
pnpm -r test                                   # all unit/e2e tests across packages (Vitest)
pnpm -r typecheck                              # type-check every package
pnpm --filter @gilgamesh/<pkg> test            # one package, e.g. @gilgamesh/domain | application | ui | web | api
pnpm --filter @gilgamesh/api test -- <file>    # a single test file (Vitest filter)
pnpm --filter @gilgamesh/web dev               # Vite dev server (web)
docker compose up -d postgres                  # local Postgres 16 + pgvector (needs Docker Desktop running)
pnpm --filter @gilgamesh/api prisma:migrate    # apply Prisma migrations to the DB
pnpm --filter @gilgamesh/api test:int          # integration tests against real Postgres
```

If a fresh Docker Desktop install isn't on the shell PATH yet, invoke it by full path and add its bin dir
(for the credential helper): `& "C:\Program Files\Docker\Docker\resources\bin\docker.exe"` with
`$env:PATH = "C:\Program Files\Docker\Docker\resources\bin;" + $env:PATH` (PowerShell). Prisma connects to
`localhost:5432` regardless of which shell started the container.

Notes:
- pnpm 11 blocks dependency build scripts by default; approved ones live under `allowBuilds:` in
  `pnpm-workspace.yaml` (currently `esbuild`, `@swc/core`). Add new native builders there.
- The API (`apps/api`, NestJS) tests run under Vitest via **unplugin-swc** (decorator metadata) — see
  `apps/api/.swcrc` and `apps/api/vitest.config.ts`. It is `type: commonjs`; the rest of the repo is ESM.

## Architecture / layout

```
packages/domain        — entities, value objects, the 11-agent roster, pure logic. No framework imports.
packages/application   — use cases + PORT interfaces (repositories, PasswordHasher, IdGenerator, Clock,
                         TokenGenerator) + in-memory repository adapters (temporary persistence + test doubles).
packages/ui            — React design-system components (tokens dark/light, Button, StatusDot, AgentTile).
apps/web (Vite+React)  — screens (Login, Onboarding, AgentRoom) wired by React Router (login→onboarding→
                         agent room) with session + injectable-clients providers; screens use typed client ports.
apps/api (NestJS)      — controllers (auth, projects, agents) + SessionAuthGuard + ValidationPipe +
                         DomainExceptionFilter; infra adapters (Argon2id, UUID v7, crypto session token).
```

Key seams:
- **Use cases never touch frameworks.** Controllers/repos are adapters that wire ports to implementations
  in `apps/api/src/persistence/persistence.module.ts` (DI tokens in `persistence/tokens.ts`).
- **Two persistence wirings, same ports:** in-memory (`PersistenceModule`, used by the default Docker-free
  tests) and **Prisma/Postgres** (`PrismaPersistenceModule` + `apps/api/src/persistence/prisma/*`, used by
  `test:int` and production). UI, controllers and use cases are identical across both — only the bound adapters differ.
- **Tenant isolation + authz live in the use cases** (`requireProjectAccess`): a non-member gets `NOT_FOUND`
  (never 403) so project existence is not leaked across tenants.
- Cross-package imports resolve to source via tsconfig `paths` + Vitest `resolve.alias` (no build step for
  dev/test). Production builds use `tsup`/`vite`/Nest.

## Slice 1 status (Auth + Onboarding + Agent room)

Built and green (80 tests): domain, application (all use cases), ui, web (3 screens + React Router flow
login→onboarding→agent room), the full API surface (`/auth/{register,login}`, `POST /projects`,
`GET|PATCH /projects/:id/agents`, `POST .../wake-all`) with auth guard, validation, error mapping, real
Argon2id, AND **Prisma persistence against real Postgres** — schema + migration applied (slice-1 subset of
`specs/data-model/schema.prisma`; `apps/api/prisma/`), Prisma repository adapters, and a real-DB integration
suite (`pnpm --filter @gilgamesh/api test:int`, 3 tests). The default `pnpm --filter @gilgamesh/api test`
stays in-memory (Docker-free); `*.int.test.ts` runs only via `test:int`.

**Remaining for slice-1 Definition of Done:** BDD acceptance (Cucumber-js running `specs/slices/01-*/*.feature`
against the API+DB) · Playwright e2e against the running web+api+db stack · wire the production bootstrap
(`apps/api` `main.ts`) to `PrismaPersistenceModule`. (Web auth is client-side state only for now; a `/auth/me`
bootstrap to restore the session on reload is a small later refinement.)
