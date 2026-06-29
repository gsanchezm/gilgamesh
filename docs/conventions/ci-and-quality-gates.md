# Gilgamesh — CI Pipeline & Quality Gates

> Status: foundation design artifact (v0.1, 2026-06-29). Pairs with
> [`engineering-methodology.md`](./engineering-methodology.md) (the SDD→BDD→TDD loop and Definition of Done).
> Authoritative inputs: [`specs/_keystone/foundation-vocabulary.md`](../../specs/_keystone/foundation-vocabulary.md),
> [`docs/research/decisions-log.md`](../research/decisions-log.md).
> This is a **design spec**. The YAML below is **illustrative** and is *not* committed as a runnable workflow by
> this artifact (no `.github/workflows/*.yml` is created here). It pins names, gates, and fail-mechanisms so the
> workflow can be authored faithfully later.

---

## 1. Principles

1. **Logic in package scripts, CI is thin.** Every gate is a `pnpm` / Turborepo script that runs identically on a
   developer laptop and in CI. The **canonical workspace scripts** (`lint`, `lint:boundaries`, `typecheck`,
   `test`, `test:bdd`, `test:e2e`, `build`, `openapi:gen`) are defined in
   [`monorepo.md`](./monorepo.md) §3.3; this doc adds the **security/performance gate scripts** on top
   (`size`, `perf:smoke`, `sast`, `deps:scan`, `contract:check`, `dast`, `test:mutation`, `lhci`). This keeps
   GitHub Actions and the future **Azure Pipelines** adapter (decisions §12, keystone keys `gha`/`azpipe`) thin
   wrappers around the same commands — parity is cheap (§8).
2. **PR-fast vs nightly-deep.** A PR must give signal in **≤ 15 min p95**. Slow, heavy gates (DAST, full
   cross-browser e2e, full load, mutation) run **nightly / pre-merge**, not on every push (§3 vs §4).
3. **Every gate fails closed with a concrete exit code.** No gate is advisory once promoted; each has a defined
   failure mechanism (k6 `thresholds` → non-zero exit, `size-limit` exit code, coverage threshold, baseline
   compare). Listed per gate below.
4. **Security and performance are gates, not reports** (decisions cross-cutting mandates). Tenant isolation,
   secrets-as-Key-Vault-refs, signed URLs, RBAC, and the perf budgets each have an enforcing check.
5. **No secret leaves Key Vault.** CI authenticates to Azure via **OIDC workload-identity federation** (no
   long-lived cloud credentials in GitHub). Application secrets are **Key Vault references** only — matching the
   keystone rule that `Integration.secretRef` is "NEVER raw token."

---

## 2. Pipeline shape

```
                         ┌─ lint ─────────────┐
                         ├─ lint:boundaries ──┤   (import boundaries — monorepo.md §4)
                         ├─ typecheck ────────┤
   install + turbo cache ┼─ unit (Vitest) ────┼─ quality-gate (required) ─▶ mergeable
   (pnpm, frozen lock)   ├─ bdd (Cucumber-js) ┤
                         ├─ build → bundle-size┤
                         ├─ perf-smoke (k6) ──┤
                         ├─ contract (OpenAPI)─┤
                         ├─ e2e-ui smoke (PW) ─┤
                         ├─ sast-fast (Semgrep)┤
                         ├─ secret-scan ──────┤
                         └─ deps-scan ────────┘

   nightly / pre-merge (merge_group + schedule):
     full e2e matrix · full k6 load · DAST (ZAP) · CodeQL · mutation (Stryker) · Lighthouse CI
     · dogfood-when-delivered (chaos-proxy, gated)
```

`concurrency:` cancels superseded runs per ref. All jobs depend on a single `install` job that restores the
Turborepo cache (remote cache keyed on lockfile + inputs) so unchanged packages are skipped.

---

## 3. PR pipeline — gates that block a PR

Each row: the gate, its command, and **how it fails the build**. All are required inputs to the aggregate
`quality-gate` check enforced by branch protection.

| Gate | Tool / command | Fails the build when |
|------|----------------|----------------------|
| **lint** | ESLint + Prettier `--check` via `pnpm lint` | any ESLint error or format drift. Non-zero exit. |
| **lint:boundaries** | **eslint-plugin-boundaries** + **dependency-cruiser** via `pnpm lint:boundaries` (gate owned & detailed in [`monorepo.md`](./monorepo.md) §4) | any forbidden import edge: `@gilgamesh/domain` importing a framework, an inner ring importing an outer ring, or a delivery slice reaching into another slice's internals (keystone §4 — Law of Demeter). Non-zero exit. |
| **typecheck** | `tsc -b` across the workspace via `pnpm typecheck` | any type error. Non-zero exit. |
| **unit** | **Vitest** `--coverage` via `pnpm test` | any failing test; **coverage below threshold** (§5.4): `@gilgamesh/domain` & `@gilgamesh/application` < 90% lines/branches, adapters < 70%, repo < 80%, or **diff-coverage < 90%** on changed lines. |
| **bdd-acceptance** | **Cucumber-js** (`@pr` tag) + Testcontainers (Postgres/pgvector, Redis, MinIO) via `pnpm test:bdd` | any non-passing scenario (failed/undefined/pending). `@blocked-until-delivered` excluded. Non-zero exit. |
| **build** | Turborepo `pnpm build` (all apps/packages) | any build/compile failure. |
| **bundle-size** | **size-limit** against committed baseline, `pnpm size` | any tracked `apps/web` bundle exceeds its absolute budget **or** regresses > 10% vs baseline (§5.2). size-limit exits non-zero. |
| **perf-smoke** | **k6** smoke (low VU) with `thresholds`, `pnpm perf:smoke` against the docker stack | any endpoint p95 over budget or error-rate over budget (§5.1). k6 `thresholds` breach → non-zero exit. |
| **contract** | OpenAPI diff (`oasdiff`) + `@gilgamesh/api-client` drift check via `pnpm contract:check` (re-runs `openapi:gen`, asserts no diff) | runtime schema diverges from keystone §6 OpenAPI, a **breaking** change is unannounced, or the generated client is stale. Non-zero exit. |
| **e2e-ui (smoke)** | **Playwright** smoke subset (1 browser) + token-conformance + visual-baseline diff | a smoke flow fails, a §6/§11 design token mismatches, or a screen diff exceeds tolerance vs **committed baseline** (methodology §8). |
| **sast-fast** | **Semgrep** ruleset via `pnpm sast` | any High/Critical finding (e.g. raw SQL bypassing Prisma, missing `orgId` filter pattern, secret literal). Non-zero exit. |
| **secret-scan** | **gitleaks** (history + diff) | any detected secret/token in code or git history. Non-zero exit. Reinforces keystone "NEVER raw token." |
| **deps-scan** | **osv-scanner** + `pnpm audit --prod` + lockfile-integrity | any known High/Critical vuln with a fix available, or lockfile tampering. Non-zero exit. |

The **quality-gate** job is a no-op aggregator that depends on all of the above; branch protection requires it.
This keeps the required-checks list to one stable name as jobs are added/sharded.

---

## 4. Nightly / pre-merge — deep gates

Too slow for every PR; run on `schedule` (nightly) and on the `merge_group` (merge queue) before landing.

| Gate | Tool | Purpose / fail condition |
|------|------|--------------------------|
| **e2e full matrix** | Playwright (Chromium/Firefox/WebKit; `apps/mobile` smoke via Expo) | any flow fails on any target. |
| **load** | **k6** full load profile | sustained-load p95/throughput/error budgets breached (§5.1). |
| **DAST** | **OWASP ZAP** baseline + active scan against an ephemeral deployed env | any High alert: missing secure header, reflected/stored XSS, **CSRF gap** (no `X-CSRF-Token` double-submit enforced on an unsafe method), **insecure cookie** (session cookie not `__Host-`-prefixed / not httpOnly+Secure+SameSite), **permissive CORS** (`Access-Control-Allow-Origin: *` *with* credentials, or any origin outside the pinned allowlist reflected with `Allow-Credentials: true`), exposed blob. |
| **SAST deep** | **CodeQL** (TypeScript) | any High/Critical alert. |
| **mutation** | **Stryker** on `@gilgamesh/domain` | mutation score < 70% (warn → gate once stable). |
| **web-vitals** | **Lighthouse CI** (throttled) on the Agent-room route | LCP > 2.5s, TBT > 200ms, CLS > 0.1, or perf score < 0.90 (§5.3). |
| **dogfood (real)** | agents → `TestKernel.plan` → chaos-proxy `:50051` → OmniPizza SUT | **gated `@blocked-until-delivered`** (keystone §7) until owner ships chaos-proxy image + Playwright plugin + OmniPizza + proto. Skipped, not failed, until then. |

---

## 5. Performance budgets (enforced in CI)

Performance is first-class (decisions cross-cutting mandate). Budgets are **committed numbers**; CI fails when a
change breaches them. Numbers are initial targets for the QA-sized single small instance (decisions §11) and are
revisited per slice in `spec.md`.

### 5.1 API latency & error budgets (k6 `thresholds`)
Measured against the docker-compose stack with a seeded tenant, warm cache, single small API instance.

| Endpoint class | Representative path (keystone §6) | p95 budget | Notes |
|----------------|-----------------------------------|-----------|-------|
| Auth verify (KDF) | `POST /auth/login` | **≤ 600 ms** | Argon2id is intentionally costly |
| Session check | `GET /auth/me` | **≤ 80 ms** | hot path on every request |
| List (cursor) | `GET /projects/{id}/test-cases` | **≤ 200 ms** | tenant-filtered + paginated |
| Detail | `GET /runs/{id}` | **≤ 150 ms** | |
| Mutation | `POST /projects/{id}/test-cases` | **≤ 400 ms** | write + validation |
| Enqueue run | `POST /projects/{id}/runs` | **≤ 300 ms** | BullMQ enqueue only |
| Agent-room list | `GET /projects/{id}/agents` | **≤ 200 ms** | slice-1 hot path; one join, no N+1 (slice §10.1) |
| Run report | `GET /runs/{id}/report` | **≤ 300 ms** | heaviest read; bounded assembly ≤ 3 queries; drill-down paginated |
| Vector retrieval | RAG top-k (k≤8, tenant-scoped) | **≤ 150 ms** | pgvector HNSW; asserted with a **recall@k** floor (data-model §6.4/§10) |
| Wake-all | `POST /projects/{id}/agents/wake-all` | **≤ 250 ms** | bulk upsert of 11 bindings |
| Onboarding bootstrap | `POST /orgs` then `POST /projects` | **≤ 800 ms** combined | multi-write tx seeding 11+11 rows (slice §10.1) |
| **SSE connect** | `GET /runs/{id}/events` | **≤ 200 ms** (request → first byte/snapshot) | canonical set — see below |
| **SSE event fan-out** | kernel emit → SSE client byte | **≤ 250 ms** p95, ≤ 500 ms p99 | **the highest-value runtime metric; now gated** |
| **SSE time-to-first-event** | enqueue → first `NODE_STATE` on SSE | **≤ 1.5 s** (warm worker) | excludes cold KEDA scale-up |

**Canonical SSE budgets (single source: `run-lifecycle.md` §7).** The three SSE rows above are the *one*
canonical set — `openapi.v1.yaml` (info budgets) and `api/README.md` reference these exact numbers; the
prior "SSE first byte ≤ 500 ms" / "≤ 300 ms time-to-first-event" wordings are superseded and reconciled so
"enforced in CI" matches the prose. **SSE fan-out latency is a first-class k6/SSE threshold** (previously CI
checked only connect/first-event).

Cross-cutting: **error rate < 0.1%** (excluding intended negative-test 4xx); **throughput floor ≥ 50 rps** on the
list endpoint without breaching its p95. **Fail mechanism:** these are k6 `thresholds` (and an SSE-harness
threshold for fan-out latency + a `recall@k` assertion for vector retrieval); any breach exits non-zero and
fails `perf-smoke` (PR) / `load` (nightly).

### 5.2 Bundle size (`apps/web`, gzip; size-limit)

| Asset | Budget |
|-------|--------|
| Entry / app-shell JS | **≤ 200 KB** |
| Largest lazy route chunk | **≤ 150 KB** |
| First route total transfer (Agent room) | **≤ 350 KB** |
| Web fonts (Marcellus + IBM Plex Sans/Mono subset, preloaded) | **≤ 120 KB** |

**Fail mechanism:** `size-limit` compares against the committed baseline; build fails on absolute-budget breach
or > 10% regression. Routes are lazy/streamed (decisions cross-cutting: "lazy/streamed UI").

### 5.3 Web vitals (Lighthouse CI, nightly)
Agent-room route, throttled mid-tier: **LCP ≤ 2.5s, TBT ≤ 200ms, CLS ≤ 0.1, performance score ≥ 0.90.** Breach
fails the `web-vitals` gate. **This `LCP ≤ 2.5s` is the canonical Agent-room LCP** referenced by
`ARCHITECTURE.md` §7.1 and `slice 01 §10.1` (reconciles the prior `< 2.0 s` / `< 2.5 s` drift).

### 5.4 Coverage & mutation
domain/application ≥ 90% lines+branches · adapters ≥ 70% · repo ≥ 80% · **diff-coverage ≥ 90%** on changed lines.
Mutation score (domain, nightly) ≥ 70%. Under threshold → non-zero exit.

### 5.5 Runner concurrency / waves
The kernel's parallelism is tiered (keystone §9 / prototype §5): **TEAM 3 lanes · PRO 10 · ENTERPRISE ∞.**

- **Unit gate:** a Vitest test on `TestKernel.plan(...)` output asserts every wave's width ≤ the `Plan` tier cap
  (`waves: string[][]` in the `RunPlan`). A plan that would exceed the tenant's tier fails the test.
- **Integration gate:** an `apps/workers` test asserts BullMQ consumer concurrency honours the tier cap (no more
  than N `RunNode`s in `RUNNING` simultaneously for a tier-N tenant).
- **CI wall-clock budget:** PR pipeline p95 ≤ 15 min; unit shard ≤ 5 min; e2e smoke ≤ 10 min. The pipeline is
  sharded + Turbo-cached to hold this; a sustained breach is a pipeline-health alert (not a per-PR hard fail).

---

## 6. Illustrative GitHub Actions workflow (design example — not committed here)

```yaml
# .github/workflows/ci.yml  —  ILLUSTRATIVE design example (authored later, not by this artifact)
name: ci
on:
  pull_request:
  merge_group:
  schedule: [{ cron: "0 3 * * *" }]   # nightly deep gates
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
permissions:
  contents: read
  id-token: write          # OIDC federation to Azure Key Vault — no long-lived secrets
  security-events: write   # CodeQL / SARIF upload

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      # Turborepo remote cache restored here; downstream jobs reuse it.

  lint:        { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm lint }] }            # eslint + prettier --check
  boundaries:  { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm lint:boundaries }] } # eslint-boundaries + dep-cruiser (monorepo.md §4)
  typecheck:   { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm typecheck }] }
  unit:        { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm test }] }            # vitest --coverage
  bdd:         { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm test:bdd }] }        # cucumber-js + testcontainers
  build:       { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm build }] }
  bundle-size: { needs: build,   runs-on: ubuntu-latest, steps: [{ run: pnpm size }] }            # size-limit
  perf-smoke:  { needs: build,   runs-on: ubuntu-latest, steps: [{ run: pnpm perf:smoke }] }      # k6 thresholds
  contract:    { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm contract:check }] }  # oasdiff + openapi:gen drift
  e2e-ui:      { needs: build,   runs-on: ubuntu-latest, steps: [{ run: pnpm test:e2e -- --grep @smoke }] }
  sast-fast:   { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm sast }] }            # semgrep
  secret-scan: { runs-on: ubuntu-latest, steps: [{ uses: gitleaks/gitleaks-action@v2 }] }
  deps-scan:   { needs: install, runs-on: ubuntu-latest, steps: [{ run: pnpm deps:scan }] }       # osv-scanner + pnpm audit

  quality-gate:            # the single REQUIRED check (branch protection)
    needs: [lint, boundaries, typecheck, unit, bdd, bundle-size, perf-smoke, contract, e2e-ui, sast-fast, secret-scan, deps-scan]
    runs-on: ubuntu-latest
    steps: [{ run: echo "all PR gates green" }]

  # --- nightly / merge_group deep gates (guarded by event) ---
  dast:        { if: github.event_name != 'pull_request', runs-on: ubuntu-latest, steps: [{ run: pnpm dast }] }  # OWASP ZAP
  codeql:      { if: github.event_name != 'pull_request', runs-on: ubuntu-latest, steps: [{ uses: github/codeql-action/analyze@v3 }] }
  mutation:    { if: github.event_name == 'schedule',     runs-on: ubuntu-latest, steps: [{ run: pnpm test:mutation }] }   # stryker
  web-vitals:  { if: github.event_name == 'schedule',     runs-on: ubuntu-latest, steps: [{ run: pnpm lhci }] }            # lighthouse-ci
```

---

## 7. OWASP ASVS L2 — control map

Target: **OWASP ASVS Level 2** (decisions cross-cutting mandate). Mapped by **stable chapter theme** rather than
granular requirement IDs (IDs churn between ASVS versions; themes are stable). Each row ties an ASVS theme to the
**keystone artifact** that implements it and the **CI gate/test** that verifies it — so the checklist enforces the
frozen vocabulary, not a parallel model. The **exact ASVS version and requirement-ID-level mapping are pinned in
Paso 2** against the published spec (same discipline the decisions log applies to model IDs — verified, not
quoted from memory); the theme mapping below is used deliberately so it stays valid across ASVS versions.

| ASVS theme | Gilgamesh control (keystone artifact, verbatim) | Enforced in | CI gate / test |
|------------|--------------------------------------------------|-------------|----------------|
| Architecture & Threat Modeling | Clean-Arch layer map + inward-only deps (§4); ports (§5); `TestKernel` seam isolates the kernel | `@gilgamesh/*` boundaries | **lint:boundaries** (eslint-boundaries + dependency-cruiser) |
| Authentication | `User.passwordHash` = **Argon2id**; `/auth/*` flows; login throttle; `IdentityProvider` port (LOCAL now, OIDC/SAML later) | `apps/api` auth, `@gilgamesh/application` | unit + **bdd** (`login.feature`) + **dast** |
| Session Management | `Session` (`tokenHash`, `expiresAt`, `revokedAt?`); httpOnly + Secure + SameSite cookie (keystone §0) | `apps/api` session | unit + e2e cookie-flag assertion + **dast** |
| Access Control / Authorization | **RBAC** via `Role` (OWNER/ADMIN/MEMBER/VIEWER) + `Membership`; **tenant isolation**: `orgId` on every row, filtered in **every** query (keystone §0); deny-by-default, object-level checks | `@gilgamesh/domain` + Prisma repos | **unit** tenant-isolation suite (foreign `orgId` → not-found) + RBAC tests + **bdd** cross-tenant scenarios |
| Validation, Sanitization & Encoding | `*Create`/`*Update` DTO validation (class-validator); Prisma **parametrized** (no raw SQL); `Problem` (RFC9457) errors (keystone §6) | `apps/api` controllers | unit + **sast** (raw-SQL rule) |
| Cryptography & Secret Management | Secrets only as **Key Vault refs** — `Integration.secretRef` "NEVER raw token"; no secret literals; CI uses OIDC federation | config + Bicep Key Vault | **secret-scan** (gitleaks) + config review |
| Error Handling & Logging | `Problem+json` (no leakage); **`AuditLog`** (`action`/`targetType`/`targetId`/`actorUserId`) on sensitive actions | `apps/api` + `@gilgamesh/application` | unit audit-assertion tests + **sast** |
| Data Protection | `orgId` isolation; `Artifact` "never public" via **`ArtifactStorage.signedUrl(key, ttlSec)`** signed expiring URLs | `@gilgamesh/integrations` storage | unit signed-URL-expiry test + tenant-isolation suite + **dast** (no public blob) |
| Communications / TLS | TLS 1.2+ at ingress; **HSTS**; gRPC to chaos-proxy (`:50051`) over TLS/mTLS | infra (Bicep) + helmet | **dast** (HSTS/TLS) + header test |
| Files, Resources & SSRF | `KnowledgeDoc` upload validation (size/type) → `storageKey`; repo-connector **SSRF allowlist** | `@gilgamesh/integrations` | unit upload-validation + **sast** SSRF rule |
| API & Web Service | `/api/v1`; **CORS** allowlist; **CSRF** token for cookie-auth mutations; **rate-limit** headers (keystone §6); cursor pagination | `apps/api` middleware | unit + header tests + **dast** (CSRF/CORS) |
| Configuration / Secure Headers | helmet: **CSP**, **HSTS**, `X-Content-Type-Options`, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` | `apps/api` bootstrap | secure-header unit test + **dast** |
| Business Logic / Rate limiting & Quotas | `Subscription.runMinutesQuota`/`runMinutesUsed` enforcement; per-IP + per-`orgId` throttling | `@gilgamesh/application` | unit quota/throttle tests + integration |
| Dependency / Supply Chain | Pinned lockfile integrity; SBOM; vuln gating | workspace | **deps-scan** (osv-scanner) + **codeql** + **secret-scan** |

Every named control in the brief is covered: **RBAC, tenant isolation, secrets in Key Vault, TLS, signed URLs,
input validation, rate limiting, secure headers, CSRF/CORS, audit log.**

---

## 8. Azure Pipelines parity (later adapter)

GitHub Actions (`gha`) is the source of truth now; **Azure Pipelines (`azpipe`) parity comes later** (decisions
§12). Parity is cheap because **Principle 1** keeps all logic in `pnpm`/Turborepo scripts: the Azure Pipelines
YAML will be a thin adapter that calls the same `pnpm lint | typecheck | test:unit | test:bdd | build | size |
perf:smoke | test:e2e | sast | deps:scan` and maps:

- GitHub OIDC `id-token` → Azure Pipelines **workload-identity service connection** (still no long-lived secrets;
  Key Vault refs only).
- `quality-gate` required check → an Azure **branch policy** with equivalent required stages.
- nightly `schedule` → Azure **scheduled trigger**.
- the same gate thresholds (§5) and the same ASVS map (§7) apply unchanged.

Both keys exist in the keystone integration set (§8): `gha` and `azpipe` under `CICD`. No gate definition changes
when the adapter is added — only the wrapper.

---

## 9. Secrets & CI identity

- CI authenticates to Azure with **OIDC workload-identity federation**; **zero** long-lived cloud credentials in
  the CI provider.
- Application secrets are **Key Vault references**, consistent with `Integration.secretRef` (never raw tokens) and
  the foundation Bicep (decisions §11: Key Vault provisioned, deployed only when the owner says so).
- `secret-scan` (gitleaks) runs on diff **and** history; a hit fails the build and is treated as an incident
  (rotate, don't just delete).
- Test fixtures use clearly-fake, non-routable values; the `secret-scan` allowlist is reviewed, never expanded to
  silence a real finding.
