# Gilgamesh — Engineering Methodology (SDD → BDD → TDD)

> Status: foundation design artifact (v0.1, 2026-06-29). Authoritative inputs:
> [`specs/_keystone/foundation-vocabulary.md`](../../specs/_keystone/foundation-vocabulary.md) (FROZEN keystone — names/enums/ports),
> [`docs/research/decisions-log.md`](../research/decisions-log.md) (owner decisions),
> [`docs/research/gilgamesh-prototype-extract.md`](../research/gilgamesh-prototype-extract.md) (UI/screens reference).
> This document is a **convention spec**, not runnable code. The enforcement of every gate named here lives in
> [`ci-and-quality-gates.md`](./ci-and-quality-gates.md).

---

## 1. Purpose

Gilgamesh is a multi-tenant QA platform. We hold ourselves to the standard we sell: **every behaviour is
specified before it is built, expressed as an executable acceptance test before it is coded, and driven into
existence by failing unit tests first.** The loop is **SDD → BDD → TDD**:

- **SDD (Spec-Driven Development)** — a written, approved slice spec under `/specs` is the contract. No code
  without an approved spec.
- **BDD (Behaviour-Driven Development)** — the spec's acceptance criteria become Gherkin `.feature` files run by
  **Cucumber-js**. They are the executable definition of "the slice works."
- **TDD (Test-Driven Development)** — each use case and domain rule is delivered red → green → refactor with
  **Vitest**. UI behaviour is pinned with **Playwright**.

Two cross-cutting mandates from the decisions log are non-negotiable inside the loop, not bolted on after:
**performance is first-class** (budgets, see CI doc) and **security is primordial** (per-`orgId` tenant isolation
on every query, secrets only as Key Vault refs, signed expiring artifact URLs, RBAC, audit, OWASP ASVS L2).

---

## 2. Two meanings of "slice" — do not blur them

The keystone defines `Slice`, `Feature`, and `Scenario` as **product data entities** (§2): the *user's* vertical
slices (Checkout/Login/Catalog/…), the user's authored Gherkin `Feature.content`, and the parsed `Scenario`
rows shown in the Test Lab. These live in the database, per `orgId`.

This document instead talks about the **engineering delivery slice** — a vertical unit of *our* work that cuts
through every layer (`@gilgamesh/domain` → `@gilgamesh/application` use cases → `apps/api` adapters →
`apps/web`/`apps/mobile` UI). Example from the decisions log:
**Slice 1 = Auth (local) + Onboarding (3 steps) + Agent room.**

The two planes meet exactly at **dogfooding** (§9): our own engineering `.feature` files can be loaded *as a
`Project` inside Gilgamesh* and executed by the agents. Keep the prose distinct: "delivery slice" = our work
item; `Slice`/`Feature`/`Scenario` (code font) = product entities.

---

## 3. The `/specs` tree

`/specs` is the SDD source of truth. The keystone already occupies `/specs/_keystone`. The full layout (shown
here as a **design example**, materialized one folder per delivery slice as work begins):

```
specs/
  _keystone/
    foundation-vocabulary.md         # FROZEN vocabulary — names/enums/ports/OpenAPI skeleton (exists)
  _templates/
    slice-spec.template.md           # the SDD template (see §4)
    acceptance.template.feature      # the Gherkin skeleton (see §5)
  slices/
    01-auth-onboarding-agent-room/
      spec.md                        # SDD: scope, use cases, API surface, budgets, security controls
      acceptance/                    # BDD: Gherkin .feature files (Cucumber-js)
        login.feature
        forgot-password.feature
        onboarding.feature
        agent-room.feature
      ui-conformance.md              # screen-structure checklist + token map vs prototype (see §8)
      review.md                      # approval record: who approved the spec, date, open risks
    02-test-lab-authoring/
    03-integrations/
    04-subscription/
    05-knowledge-rag/
    06-orchestration/                # BLOCKED-UNTIL-DELIVERED (keystone §7)
    07-reports-from-real-runs/       # BLOCKED-UNTIL-DELIVERED (keystone §7)
```

Naming rules:
- One folder per **delivery slice**, zero-padded ordinal + kebab name. Order tracks the roadmap, not priority.
- A slice folder is **immutable history once approved**; changes are new commits to `spec.md` with a bumped
  `version:` front-matter field and a new line in `review.md`.
- Acceptance `.feature` files here are **engineering acceptance for building Gilgamesh**. They are distinct from
  a user's `Feature.content` rows, though identical in syntax (that symmetry is what makes dogfooding clean).

### 3.1 Slice spec template (`spec.md`) — design example

```markdown
---
slice: 01-auth-onboarding-agent-room
version: 1
status: draft | approved | superseded
owner: <approver>
keystone-refs: [User, Org, Membership, Session, Project, Agent, ToolBinding]   # §2 entities touched
---

# Slice 01 — Auth + Onboarding + Agent room

## Scope (in / out)
IN:  local email/password auth (Argon2id), 3-step onboarding (Org + Project + optional repo),
     Agent room (11 seeded Agents, runtime status, wake/sleep, KPIs).
OUT: per-agent chat + voice (later slice, decisions §3).

## Use cases (one per slice action — keystone §4)
- RegisterUser, LoginUser, LogoutUser, GetMe, RequestPasswordReset, ResetPassword
- CreateProject (onboarding: creates Project [+ repo link])
- ListProjectAgents, PatchAgentToolBinding, WakeAllAgents

## API surface (keystone §6 — verbatim paths/schemas)
POST /auth/register|login|logout ; GET /auth/me ; POST /auth/forgot-password|reset-password
POST /projects (onboarding) ; GET /projects/{id}/agents ; PATCH /projects/{id}/agents/{slot}
POST /projects/{id}/agents/wake-all
Schemas: UserView, ProjectCreate/View, AgentView, ToolBindingView, Problem (RFC9457)

## Acceptance criteria  → become acceptance/*.feature (§5)
- ...

## Performance budget (this slice)   → enforced in CI (ci-and-quality-gates.md §5)
- POST /auth/login p95 ≤ 600 ms (Argon2id); GET /auth/me p95 ≤ 80 ms; GET .../agents p95 ≤ 200 ms.

## Security controls (this slice)    → ASVS L2 map (ci-and-quality-gates.md §7)
- Every query filters by orgId (resolved session → orgId). Argon2id hashing. httpOnly+Secure+SameSite cookie.
- AuditLog on register/login/reset. Rate-limit login. CSRF token for cookie-auth mutations.

## Definition of Done           → §6 checklist
```

---

## 4. SDD phase — write and approve the spec

1. Author `spec.md` from the **keystone vocabulary verbatim** (entity names §2, enum values §1, port signatures
   §5, OpenAPI paths/schemas §6). If a needed name is absent, the keystone is amended *first* (keystone rule),
   never invented locally in the spec.
2. The spec states scope, the **use cases (one per slice action)**, the API surface it touches, the
   **performance budget** for its endpoints, and the **security controls** (which ASVS themes apply).
3. **Approval gate**: the slice owner records sign-off in `review.md` and sets `status: approved`. Code review on
   a delivery PR **rejects** any slice whose `spec.md` is still `draft`. Spec-approved is the first item of the
   Definition of Done (§6).

A spec is small on purpose — one delivery slice, mapping to one column of the roadmap. Big specs are a smell;
split the slice.

---

## 5. BDD phase — spec → Gherkin `.feature` (Cucumber-js)

Acceptance criteria become **Cucumber-js** scenarios. These are the contract a reviewer reads to know the slice
is done — written in domain language, not implementation language.

### 5.1 Acceptance feature — design example (`acceptance/login.feature`)

```gherkin
Feature: Local login
  As a member of an Org
  I want to sign in with email and password
  So that my session is scoped to my tenant

  Background:
    Given an Org "acme" exists
    And a User "ada@acme.test" with role MEMBER in "acme"

  Scenario: Successful login issues a tenant-scoped session
    When I POST /auth/login with "ada@acme.test" and the correct password
    Then the response status is 200
    And a Session is created for that User
    And the session cookie is httpOnly, Secure and SameSite
    And every subsequent query resolves orgId for "acme" only

  Scenario: Wrong password is rejected and audited
    When I POST /auth/login with "ada@acme.test" and a wrong password
    Then the response status is 401
    And the body is a Problem (RFC9457) document
    And an AuditLog row records the failed attempt
    And no Session is created
```

### 5.2 Wiring rules

- **Step definitions call the `@gilgamesh/application` use cases through the same ports an adapter would**
  (`AgentBrainPort`, `ArtifactStorage`, `PaymentProvider`, `IdentityProvider`, `EventBus`, `TestKernel`). For
  acceptance runs the ports are bound to **real infra via Testcontainers** (Postgres + pgvector, Redis, MinIO)
  or in-memory fakes where the keystone marks a dependency as mock (PaymentProvider = Mock now).
- A scenario is **red first**: undefined/pending steps fail. It goes green only when the use case + adapters
  exist. Acceptance-green is a Definition-of-Done item (§6).
- Tags drive CI selection: `@pr` (fast, runs on every PR), `@nightly` (slow), `@blocked-until-delivered`
  (kernel/chaos-proxy scenarios — see keystone §7; excluded from the build until the owner ships the
  dependency).
- **Tenant isolation is asserted in BDD, not assumed**: cross-tenant scenarios ("a MEMBER of `acme` cannot read
  `globex` data → 404, not 403") are mandatory for any slice that adds a tenant-scoped query.

---

## 6. TDD phase — red → green → refactor (Vitest)

Acceptance scenarios prove the slice from the outside; **unit tests** drive the inside. For each use case and
each domain rule:

1. **Red** — write a failing Vitest spec next to the unit it describes
   (`*.spec.ts` mirroring the package layout). It encodes one behaviour or one branch.
2. **Green** — write the minimum domain/application code to pass. `@gilgamesh/domain` has **zero framework
   imports** (keystone §4); it is pure and therefore the fastest, highest-coverage layer.
3. **Refactor** — clean up under green, including pushing logic *inward* (out of adapters into the domain) and
   deleting duplication. Import-boundary lint (dependency-cruiser) guards the direction of dependencies.

### 6.1 Test pyramid mapped to the monorepo

| Level | Tool | Lives in | Asserts | Budget |
|------|------|----------|---------|--------|
| Unit | Vitest | `@gilgamesh/domain`, `@gilgamesh/application`, `@gilgamesh/ui` | pure logic, use-case orchestration, component render | domain/application ≥ 90% lines & branches |
| Adapter / integration | Vitest + Testcontainers | `apps/api` infra (Prisma repos, BullMQ, `ArtifactStorage`) | repositories filter by `orgId`; ports honoured | adapters ≥ 70% |
| Acceptance (BDD) | Cucumber-js | `specs/slices/*/acceptance` | slice behaviour end-to-end through ports | all `@pr` scenarios green |
| Contract | Vitest + OpenAPI | `@gilgamesh/api-client` vs `apps/api` | runtime matches keystone §6 schemas; no drift | zero drift |
| E2E UI | Playwright | `apps/web` (and `apps/mobile` smoke) | real browser, prototype conformance (§8) | smoke on PR, full matrix nightly |

Coverage thresholds and how they fail the build are defined in [`ci-and-quality-gates.md`](./ci-and-quality-gates.md) §5.

### 6.2 Security tests are first-class units

Two assertions are **required** on every changed slice and are reviewed as code, not optional extras:

- **Tenant isolation** — for each new tenant-scoped query, a test proves it is filtered by `orgId` and that a
  foreign `orgId` yields *not-found*, never another tenant's row. Generic helper: seed two Orgs, run the query
  as each, assert no leakage.
- **Audit** — for each sensitive action, a test asserts an `AuditLog` row is written with `action`,
  `targetType`, `targetId`, `actorUserId`.

---

## 7. Definition of Done (per delivery slice)

A slice is Done only when **all** of the following are true. Each maps to a CI gate (right column) so "Done" is
machine-verified, not asserted.

| # | Definition-of-Done item | Verified by |
|---|--------------------------|-------------|
| 1 | **Spec approved** — `spec.md` `status: approved`, `review.md` signed | PR review check; spec-status lint |
| 2 | **Gherkin acceptance green** — all `@pr` Cucumber-js scenarios pass | `bdd-acceptance` job |
| 3 | **Unit green** — Vitest passes; coverage ≥ thresholds; diff-coverage ≥ 90% | `unit` job |
| 4 | **Lint + type pass** — eslint + Prettier clean; **import-boundary** gate clean (`lint:boundaries`, monorepo.md §4); `tsc` clean | `lint`, `lint:boundaries`, `typecheck` jobs |
| 5 | **Security pass** — SAST, dependency scan, secret scan clean; tenant-isolation + audit tests present | `sast`, `deps-scan`, `secret-scan` jobs |
| 6 | **UI matches prototype** — token conformance + screen-structure checklist + visual baseline (§8) | `e2e-ui` + visual-baseline gate |
| 7 | **Performance budget met** — endpoint p95 + bundle size within budget | `perf-smoke`, `bundle-size` gates |
| 8 | **Contract intact** — OpenAPI ↔ `@gilgamesh/api-client` no drift; new schemas use keystone names | `contract` job |
| 9 | **Docs updated** — `spec.md`, `ui-conformance.md`, and any keystone amendment merged | PR review check |

A slice marked `@blocked-until-delivered` (keystone §7) satisfies items 1–5 and 8–9 now; items 6–7's
kernel-dependent parts wait for the owner's chaos-proxy deliverables.

---

## 8. "UI matches prototype" — operationalized

There is **no live prototype URL to pixel-diff** — the prototype is HTML design files (desktop PRIMARY, mobile
1:1) summarized in the prototype extract. "Matches the prototype" is therefore defined as three concrete,
checkable things, recorded per slice in `ui-conformance.md`:

1. **Token conformance (automated).** A test asserts the rendered app uses the frozen design tokens from the
   prototype extract §11: dark-mode default palette (`--bg #0A1626`, `--surface #0E1D33`, `--card #112441`,
   `--accent #E7C877`, …), the light-mode toggle palette, semantic status colors (pass `#3FB079`, fail
   `#E5484D`, skip `#E7C877`, blocked `#E0A23C`), radii (5/9/12/16/50%/24%), and the three fonts
   (**Marcellus** display, **IBM Plex Sans** body, **IBM Plex Mono** labels). Tokens live once in
   `@gilgamesh/ui`; the test reads computed styles in Playwright.
2. **Screen-structure checklist (review).** Each documented screen/navigation element (prototype extract §4:
   sidebar 236/68px, topbar with project dropdown + theme toggle + user menu; the eight `view`s; the 3-step
   onboarding) has a checklist line confirmed in PR review with a screenshot. **English-only, no i18n** —
   reviewers verify the ES/EN selector and `T()`/`setLang` machinery are absent (decisions §2).
3. **Visual regression vs committed baseline (automated).** Playwright captures the slice's key screens; the
   first approved screenshot becomes the **committed baseline**. Subsequent PRs diff **current vs baseline**
   (not vs the prototype) within tolerance. Baselines are updated deliberately, with reviewer sign-off, when a
   design change is intended. This is the same discipline the platform sells via the `visual` agent
   (Xochiquetzal · Pixelmatch).

---

## 9. Dogfooding — Gilgamesh tests Gilgamesh

We run our own QA discipline through our own pipeline, and (when the kernel is available) through our own
agents. Split by what the keystone makes available **now** vs **blocked-until-delivered** (§7):

### 9.1 Available now (every PR / nightly)
- Our `specs/slices/*/acceptance/*.feature` run under **Cucumber-js**; our use cases under **Vitest**; our web
  app under **Playwright** — against the local docker-compose stack (Postgres + Redis + MinIO + pgvector;
  decisions §11). This *is* Gilgamesh exercising the QA loop it preaches.
- **Self-as-Project loading**: our engineering `.feature` files are valid `Feature.content`. A nightly fixture
  loads them into a seeded `Project` (format `BDD`) so the Test Lab, parsing, and `Scenario` derivation are
  exercised on real content — without needing the runner.

### 9.2 Blocked-until-delivered (gated)
- **Agent-orchestrated real runs**: the agents (Quetzalcóatl · Playwright, Iris · API, Thor · Performance,
  Odin · Security, Ra · Accessibility, Xochiquetzal · Visual) plan a DAG via `TestKernel.plan`, execute through
  the real **chaos-proxy** (`:50051`) against a **sample SUT (OmniPizza)**, and surface `RunEvent.ARTIFACT`
  results in Reports. This requires the owner's deliverables (runnable chaos-proxy image + ≥1 Playwright plugin
  + OmniPizza + proto/intents). Until then these dogfood runs are tagged `@blocked-until-delivered` and excluded
  from the build (keystone §7). The seam (`TestKernel` port) is in place now so nothing else waits.

The intended end-state: **Gilgamesh's own web app is registered as a `Project`, and Gilgamesh's agents author
and run its acceptance suite** — the strongest possible proof the product works.

---

## 10. Branching & PR flow (where the loop runs)

1. Branch from `main` per slice (`slice/01-auth-...`). `main` is protected; no direct pushes.
2. Open a PR early (draft). The **PR pipeline** (CI doc §3) runs the fast gates on every push.
3. A PR is mergeable only when the **required `quality-gate` check is green** (aggregates DoD items 2–8) and a
   human has reviewed `spec.md` status + the screen-structure checklist (DoD items 1, 6, 9).
4. Merges to `main` trigger the **nightly/deep** suite components scheduled there (full e2e matrix, DAST, load,
   mutation) — see CI doc §4.

Conventional commits; squash-merge; the PR description links the slice spec and lists which DoD items the
diff completes.

---

## 11. Roadmap status (from keystone §7 / decisions §3)

| Slice | Runs tests? | Status |
|-------|-------------|--------|
| 01 Auth + Onboarding + Agent room | No | **Now** (not blocked) |
| 02 Test Lab authoring | No | Now |
| 03 Integrations | No | Now |
| 04 Subscription (mock `PaymentProvider`) | No | Now |
| 05 Knowledge upload / RAG | No | Now |
| 06 Orchestration (DAG real runs) | Yes | **Blocked-until-delivered** |
| 07 Reports-from-real-runs | Yes | **Blocked-until-delivered** |

Everything not blocked proceeds **now** behind the `TestKernel` port without the kernel.
