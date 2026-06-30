<div align="center">

# 🏛️ Gilgamesh

**A multi-tenant QA platform where 11 AI agents — each a mythological deity — plan, author and run software tests.**

*Testing · Trusted · Elevated.*

![The 11 deity-agents](gods.png)

</div>

---

## What is this?

Gilgamesh is a web platform for software quality assurance. Instead of writing every test by hand, you work
with a roster of **11 AI agents** (each a deity — Zeus, Athena, Anubis, Quetzalcóatl, Iris, Freya, Isis, Thor,
Xochiquetzal, Odin, Ra), each specialised in a QA discipline (web, API, mobile, performance, visual, security,
accessibility, …). They help you **author** tests, **ground** them in real QA knowledge (ISTQB + BDD), **run**
them, and keep all results in-app. It is multi-tenant (each customer is an `Org`), dark-mode by default, and
English-only.

> **New here? Read this README top to bottom, then [`CONTRIBUTING.md`](CONTRIBUTING.md) before you write code.**
> The deeper design lives in [`ARCHITECTURE.md`](ARCHITECTURE.md) and the frozen contract in
> [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md).

## Project status

**6 vertical slices are built, reviewed and shipped** (on the `main` branch). Each was built spec-first,
adversarially reviewed, and integrated only when fully green.

| # | Feature | What it does | Status |
|---|---------|--------------|--------|
| 1 | **Auth + Onboarding + Agent room** | Register/login/session (Argon2id, CSRF, rate-limit), create an Org + Project + the 11 agents, toggle agents & "wake all" | ✅ Done |
| 2 | **Test Lab (authoring)** | Author Slices, Features (Gherkin, parsed), Test Cases; AI "generate" drafts | ✅ Done |
| 3 | **Test Execution + Results** | Run a Feature/Test Case, see aggregated results | ✅ Done |
| 4 | **Subscription & Billing** | Plans, seats, mock checkout/cancel, run-minute quota | ✅ Done |
| 5 | **Knowledge / RAG** | A shared QA knowledge base (ISTQB + BDD books) searched via pgvector, used to ground generation | ✅ Done |
| 6 | **Integrations** | Connect a source repo (GitHub/GitLab/Bitbucket/ADO) and import its `.feature` files | ✅ Done |

**Coverage:** ~340 unit/integration tests · 94 BDD acceptance scenarios · 6 Playwright browser tests · CI +
CodeQL + secret-scan green · 0 security alerts.

**What's next (not built yet):** real test-execution orchestration (DAG canvas + workers), a real Claude
"Brain" (replacing the deterministic stub), per-org private document uploads, more integration types, password
reset, SSO, and real Stripe billing. See [`docs/research/decisions-log.md`](docs/research/decisions-log.md).

> ⚠️ **The 4 AI/external ports (Brain, TestKernel, PaymentProvider, RepoProvider) currently run deterministic
> offline _stubs_, not the real services.** This is intentional — it keeps the whole app testable without a
> network. The real adapters drop in behind the same interfaces later, with zero changes to the UI or business
> logic.

---

## Tech stack

- **Language:** TypeScript everywhere.
- **Monorepo:** [pnpm](https://pnpm.io) workspaces + [Turborepo](https://turbo.build).
- **API:** [NestJS](https://nestjs.com) (`apps/api`).
- **Web:** [Vite](https://vitejs.dev) + React + React Router (`apps/web`).
- **Database:** PostgreSQL 16 + [pgvector](https://github.com/pgvector/pgvector); [Prisma](https://www.prisma.io) ORM. Redis for rate-limiting.
- **Tests:** [Vitest](https://vitest.dev) (unit/integration), [Cucumber](https://github.com/cucumber/cucumber-js) (BDD acceptance), [Playwright](https://playwright.dev) (browser e2e).

---

## Quick start (zero → running)

### 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 22 | |
| **pnpm** | ≥ 9 (repo uses 11.9) | `npm i -g pnpm` |
| **Docker Desktop** | any recent | runs Postgres + Redis locally |
| **Git** | any | |

### 2. Install + start the database

```bash
git clone https://github.com/gsanchezm/gilgamesh.git
cd gilgamesh

pnpm install                              # install all workspace deps
docker compose up -d postgres redis       # start Postgres 16 (pgvector) + Redis
pnpm --filter @gilgamesh/api db:deploy    # apply database migrations
```

> **Windows note:** if `docker` isn't on your PATH yet, use the full path:
> `& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose up -d postgres redis`.

### 3. Run the app

Open **two terminals**:

```bash
# Terminal 1 — API (http://localhost:3001)
DATABASE_URL='postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public' \
REDIS_URL='redis://localhost:6379' API_PORT=3001 \
pnpm --filter @gilgamesh/api start:dev

# Terminal 2 — Web (http://localhost:5173)
pnpm --filter @gilgamesh/web dev -- --port 5173
```

Open **http://localhost:5173**, click **Register**, and you're in. (The web dev server proxies `/api` to the
API, so cookies/CSRF "just work".)

### 4. (Optional) Load the real QA knowledge base

The `/knowledge` search and AI grounding work out of the box with a small built-in sample. To load the **full
corpus** (ISTQB syllabi + BDD books, ~2,600 chunks):

```bash
DATABASE_URL='postgresql://gilgamesh:gilgamesh@localhost:5432/gilgamesh?schema=public' \
pnpm --filter @gilgamesh/api ingest:corpus
```

> The corpus lives in `rag/` and is **git-ignored** (copyrighted material kept out of this public repo).
> Ask the maintainer for it if it isn't on your machine.

---

## Running the tests

Tests are layered. The first group needs nothing; the rest need Docker (Postgres + Redis) running.

```bash
pnpm -r test                                   # ① all unit/component tests (no Docker)
pnpm -r typecheck                              # type-check every package
pnpm lint                                      # ESLint (incl. architecture-boundary rules)

pnpm --filter @gilgamesh/api test:int          # ② integration tests vs real Postgres + Redis
pnpm --filter @gilgamesh/api test:bdd          # ③ BDD acceptance (Cucumber) vs the real API + DB
pnpm --filter @gilgamesh/web test:e2e          # ④ Playwright browser tests vs the running stack
```

Run a single test file: `pnpm --filter @gilgamesh/api test -- <filename>`.

---

## How the code is organised

It's a **Clean Architecture** monorepo: **dependencies point inward only** — the domain knows nothing about
the framework. A feature is implemented once as a framework-free "use case", then wired to HTTP and to a
database by thin adapters.

```
packages/
  domain/        Pure business logic — entities, the 11-agent roster, value objects, Gherkin parser,
                 RAG math. ZERO framework imports. (← everything depends on this; it depends on nothing.)
  application/   Use cases + PORT interfaces (repositories, Brain, TestKernel, PaymentProvider, …) +
                 in-memory adapters used as test doubles and the Docker-free wiring.
  ui/            React design-system components (Button, StatusDot, AgentTile, dark/light tokens).
  kernel/        CONTRACT.md only — the spec for the external TestKernel runtime (not code yet).

apps/
  api/           NestJS HTTP layer: controllers + guards + validation + the domain→HTTP error filter,
                 plus the Prisma/Postgres adapters and the deterministic stubs. (prisma/ has the schema.)
  web/           Vite + React screens (Login, Onboarding, Agent room, Test Lab, Billing, Knowledge,
                 Integrations) wired by React Router; talks to the API through typed client "ports".

specs/           The single source of truth, frozen:
  _keystone/     foundation-vocabulary.md — every name, enum, port signature, API path. The keystone WINS.
  slices/        One folder per feature: the SDD spec (spec.md) + the Gherkin .feature acceptance files.

docs/
  ARCHITECTURE.md (at repo root)         The design, in depth.
  conventions/   engineering-methodology.md (SDD→BDD→TDD), monorepo.md, ci-and-quality-gates.md.
  research/      decisions-log.md (every owner decision + slice outcome) + the prototype extract.
```

**The two persistence wirings.** Every use case runs against either the **in-memory** adapters (default,
Docker-free, used by `pnpm test`) or the **Prisma/Postgres** adapters (used by `test:int`, `test:bdd`, and
production). The controllers, screens and use cases are identical across both — only the bound adapters differ.

---

## Where to go next

- **Want to contribute?** → [`CONTRIBUTING.md`](CONTRIBUTING.md) — how we build (SDD → BDD → TDD), step by step.
- **Want the design?** → [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **The frozen contract** (names/enums/ports/paths) → [`specs/_keystone/foundation-vocabulary.md`](specs/_keystone/foundation-vocabulary.md).
- **Why things are the way they are** → [`docs/research/decisions-log.md`](docs/research/decisions-log.md).
- **The methodology in detail** → [`docs/conventions/engineering-methodology.md`](docs/conventions/engineering-methodology.md).
