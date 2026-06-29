# Gilgamesh — Monorepo Conventions

> **Scope:** how the single platform monorepo is structured, built and **boundary-enforced**. The
> dependency rules below are the teeth behind the Clean-Architecture layering in
> [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §4 and the frozen package set in the keystone
> ([`../../specs/_keystone/foundation-vocabulary.md`](../../specs/_keystone/foundation-vocabulary.md) §4).
> **All code snippets below are illustrative spec** — the foundation does **not** ship runnable
> `pnpm-workspace.yaml` / `turbo.json` / `.eslintrc` / dependency-cruiser config; they are shown here as
> the contract a later implementation step will materialize. v0.1 — 2026-06-29.

---

## 1. Tooling: pnpm workspaces + Turborepo

- **Package manager:** **pnpm** (workspaces; content-addressable store, strict by default — a package can
  only import deps it declares, which reinforces the boundaries below). Pinned via `package.json`
  `devEngines.packageManager` (`pnpm ^11`).
- **Task runner:** **Turborepo** — a content-hashed task graph with local + remote caching, so CI rebuilds
  and re-tests only what a change actually affects.
- **Hybrid repo strategy (decisions #8):** the **platform** is this one monorepo (apps + packages);
  **capability engines** (the TOM kernel and future repos the owner adds) are **separate repos** consumed
  as versioned dependencies behind ports. The monorepo wall is not the isolation mechanism — the lint
  boundaries in §5 are.

### 1.1 Workspace layout (illustrative)

```yaml
# pnpm-workspace.yaml (illustrative — not committed in the foundation)
packages:
  - "apps/*"
  - "packages/*"
```

The folder set is **frozen** (keystone §4): `apps/{web,mobile,api,workers}` and
`packages/{domain,application,kernel,integrations,ui,api-client,config}`. Adding a workspace package
requires a keystone change, not a local decision.

---

## 2. Package naming & versioning

- **Every workspace package is `@gilgamesh/<name>`**, where `<name>` is the keystone identifier verbatim:

  | Workspace | Package name | Published? |
  |---|---|---|
  | `packages/domain` | `@gilgamesh/domain` | no (internal) |
  | `packages/application` | `@gilgamesh/application` | no |
  | `packages/kernel` | `@gilgamesh/kernel` | no |
  | `packages/integrations` | `@gilgamesh/integrations` | no |
  | `packages/ui` | `@gilgamesh/ui` | no |
  | `packages/api-client` | `@gilgamesh/api-client` | no |
  | `packages/config` | `@gilgamesh/config` | no |
  | `apps/api` | `@gilgamesh/api` | no (private app) |
  | `apps/workers` | `@gilgamesh/workers` | no |
  | `apps/web` | `@gilgamesh/web` | no |
  | `apps/mobile` | `@gilgamesh/mobile` | no |

- **Internal references** use the workspace protocol — `"@gilgamesh/domain": "workspace:*"` — never
  relative cross-package paths (`../../packages/...`). Cross-package imports go through the package's
  **public entry (barrel)**; deep imports into another package's `src/internal/**` are forbidden (§5).
- **Apps are private** (`"private": true`, never published). Packages stay internal unless a deliberate
  decision to publish is taken.
- The **capability engines** (kernel/future repos) are consumed as **normal semver dependencies**
  (e.g. the chaos-proxy proto/client), pinned and updated through `@gilgamesh/kernel` — keeping the
  multi-repo seam behind one stable port.

---

## 3. Turborepo task graph & caching

Pipelines are keyed off `dependsOn: ["^task"]` so a task waits on the same task in its dependencies, and
caching makes unchanged packages free on re-run.

### 3.1 Task pipeline (illustrative)

```jsonc
// turbo.json (illustrative — not committed in the foundation)
{
  "tasks": {
    "build":           { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck":       { "dependsOn": ["^build"] },
    "lint":            {},
    "lint:boundaries": {},                                   // import-boundary gate (§5) — CACHED, BLOCKING
    "test":            { "dependsOn": ["^build"], "outputs": ["coverage/**"] },   // Vitest (unit)
    "test:bdd":        { "dependsOn": ["^build"] },          // Cucumber-js (acceptance)
    "test:e2e":        { "dependsOn": ["^build"], "cache": false },               // Playwright (UI)
    "openapi:gen":     { "outputs": ["src/generated/**"] },  // @gilgamesh/api-client from OpenAPI
    "dev":             { "cache": false, "persistent": true }
  }
}
```

### 3.2 Caching & affected-only runs

- **Local + remote cache** keyed on inputs (source, deps, config, lockfile). CI restores cache, so only
  **affected** packages rebuild/retest — this is the lever for the CI build budget in
  [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §7.1.
- `test:e2e` and `dev` are **uncached** (real browser / long-lived). Everything else is cached.
- Determinism: tasks declare their `outputs`; non-deterministic output (timestamps, absolute paths) is
  kept out of cached artifacts.

### 3.3 Canonical scripts

`build` · `dev` · `lint` · `lint:boundaries` · `typecheck` · `test` · `test:bdd` · `test:e2e` ·
`openapi:gen`. Run via `pnpm turbo run <task>` (optionally `--filter=@gilgamesh/<pkg>`).

---

## 4. Import-boundary enforcement (the core — FAILS CI)

This is the non-negotiable section. Two complementary checks run as a **blocking CI gate**
(`lint:boundaries`): **eslint-plugin-boundaries** (ergonomic, in-editor, layer- and slice-aware) and
**dependency-cruiser** (whole-graph, catches transitive/▲dynamic edges eslint can miss). A violation
**fails the build** — it is not a warning.

### 4.1 The rules being enforced

1. **Inward-only dependency rule.** `@gilgamesh/domain` imports **nothing** but the TS stdlib — importing
   any framework (NestJS, Prisma, React, gRPC, Express, BullMQ) or any outer package fails CI.
   `@gilgamesh/application` imports `domain` only. No inner ring imports an outer ring.
2. **Allowed edges** (must match [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §4):

   | From | May import |
   |---|---|
   | `domain` | *(TS stdlib only)* |
   | `application` | `domain` |
   | `kernel` | `domain` |
   | `integrations` | `domain`, `application` |
   | `api-client` | *(generated DTOs; no domain)* |
   | `ui` | `config` (+ React/Tailwind) |
   | `config` | *(nothing runtime)* |
   | `apps/api` | `domain`, `application`, `kernel`, `integrations` |
   | `apps/workers` | `domain`, `application`, `kernel` |
   | `apps/web` | `api-client`, `ui` |
   | `apps/mobile` | `api-client`, `ui` |

3. **No app-to-app imports.** `apps/web` may not import `apps/api`, etc. Apps are composition roots/leaves.
4. **Vertical-slice no-reach-in (Law of Demeter; keystone §4).** A slice may import another slice **only**
   through its public barrel (`slices/<name>/index.ts`); importing `slices/<other>/**/internal/**` (or any
   non-barrel deep path) fails CI.
5. **No relative cross-package paths.** Cross-package imports use `@gilgamesh/*`; `../../packages/**` is
   forbidden so the package boundary is real.
6. **No raw secrets / no public blob URLs at the boundary** (defense-in-depth lint, detailed in the
   security spec): integration tokens cross boundaries only as Key Vault refs; artifact access only via the
   `ArtifactStorage.signedUrl` port.

### 4.2 eslint-plugin-boundaries (illustrative)

```jsonc
// .eslintrc.json (illustrative — not committed in the foundation)
{
  "plugins": ["boundaries"],
  "settings": {
    "boundaries/elements": [
      { "type": "domain",       "pattern": "packages/domain/*" },
      { "type": "application",  "pattern": "packages/application/*" },
      { "type": "kernel",       "pattern": "packages/kernel/*" },
      { "type": "integrations", "pattern": "packages/integrations/*" },
      { "type": "ui",           "pattern": "packages/ui/*" },
      { "type": "api-client",   "pattern": "packages/api-client/*" },
      { "type": "config",       "pattern": "packages/config/*" },
      { "type": "app",          "pattern": "apps/*" },
      { "type": "slice",        "pattern": "packages/application/src/slices/*", "capture": ["slice"] }
    ]
  },
  "rules": {
    "boundaries/no-unknown": "error",
    "boundaries/element-types": ["error", {
      "default": "disallow",
      "rules": [
        { "from": "domain",       "allow": [] },
        { "from": "application",  "allow": ["domain"] },
        { "from": "kernel",       "allow": ["domain"] },
        { "from": "integrations", "allow": ["domain", "application"] },
        { "from": "ui",           "allow": ["config"] },
        { "from": "api-client",   "allow": [] },
        { "from": "config",       "allow": [] },
        { "from": "app",          "allow": ["domain", "application", "kernel", "integrations", "ui", "api-client", "config"] }
      ]
    }],
    "boundaries/no-private": ["error", { "allowUncles": false }],
    "boundaries/entry-point": ["error", {
      "default": "disallow",
      "message": "Import another slice only through its public barrel (index.ts) — no reach-in.",
      "rules": [{ "target": ["slice"], "allow": "index.ts" }]
    }]
  }
}
```

> The per-app `allow` list is intentionally broad at the package granularity; the precise
> `apps/web → {api-client, ui}` vs `apps/api → {…}` differences are pinned per app in that app's own
> `.eslintrc` overlay (extending `@gilgamesh/config`). Slice isolation is enforced two ways: in-editor by
> `boundaries/entry-point` (a slice is only reachable through its `index.ts` barrel) and graph-wide by the
> dependency-cruiser `no-slice-reach-in` rule in §4.3.

### 4.3 dependency-cruiser (illustrative — whole-graph backstop)

```javascript
// .dependency-cruiser.cjs (illustrative — not committed in the foundation)
module.exports = {
  forbidden: [
    {
      name: "domain-stays-pure",
      severity: "error",
      from: { path: "^packages/domain" },
      to:   { pathNot: "^packages/domain", dependencyTypesNot: ["core", "type-only"] }
    },
    {
      name: "no-inward-violation",
      comment: "Outer rings may not be imported by inner rings.",
      severity: "error",
      from: { path: "^packages/application" },
      to:   { path: "^(packages/(kernel|integrations|ui|api-client)|apps)/" }
    },
    {
      name: "ui-presentation-only",
      severity: "error",
      from: { path: "^packages/ui" },
      to:   { path: "^packages/(domain|application|kernel|integrations|api-client)/" }
    },
    {
      name: "no-app-to-app",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to:   { path: "^apps/(?!$1)[^/]+/" }
    },
    {
      name: "no-slice-reach-in",
      comment: "Import another slice only through its index barrel.",
      severity: "error",
      from: { path: "src/slices/([^/]+)/" },
      to:   { path: "src/slices/(?!\\1/)([^/]+)/(?!index\\.ts$).+" }
    },
    {
      name: "no-relative-cross-package",
      severity: "error",
      from: {},
      to:   { path: "(^|/)\\.\\./\\.\\./packages/" }
    }
  ],
  options: { doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.base.json" } }
};
```

The full, normative rule set (with the secrets/signed-URL lints) lives in `@gilgamesh/config` and is
detailed in the security spec; the snippets above are the shape, not the final file.

---

## 5. CI wiring (where the gate lives)

On **GitHub Actions** (decisions #12), every PR runs — restored from Turborepo cache, affected-only:

```
pnpm install --frozen-lockfile
turbo run lint lint:boundaries typecheck build test test:bdd      # boundaries + types + unit + BDD
turbo run test:e2e                                                # Playwright UI (uncached)
# security gates (separate jobs): SAST · dependency-audit · secret-scan · DAST
```

- **`lint:boundaries` is a required, blocking check** — a domain-imports-a-framework or slice-reach-in
  violation **fails the merge**. This is the enforcement the keystone §4 and `ARCHITECTURE.md` §4/§5
  mandate.
- Performance budgets (`ARCHITECTURE.md` §7.1) — bundle size, API latency assertions — run as their own
  blocking checks (detailed in the performance + testing specs).
- Azure Pipelines parity is added later (decisions #12) by reusing the same `turbo run` tasks.

---

## 6. Conventions summary

- One monorepo for the platform; capability engines stay in their own repos behind ports.
- `@gilgamesh/*` names = keystone identifiers verbatim; cross-package imports via the public barrel and the
  `workspace:*` protocol only.
- Turborepo task graph + caching drives affected-only CI; `dev`/`test:e2e` are uncached.
- The **inward dependency rule** and **vertical-slice isolation** are enforced by
  eslint-plugin-boundaries + dependency-cruiser as a **blocking** `lint:boundaries` gate — drift fails CI,
  it does not warn.
