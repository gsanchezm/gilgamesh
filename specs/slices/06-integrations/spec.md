# Slice 6 — Integrations (connect a source repo) (SDD Spec)

> Spec-Driven-Design spec for the sixth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) → **Decisions log** → **Prototype**.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone unless marked **[S6-NEW]**.
> v0.1 — 2026-06-30. Status: DONE — built SDD→BDD→TDD, green end-to-end (typecheck + lint · ~340 Docker-free ·
> test:int 14 · BDD 94 scenarios · Playwright integrations) on branch `slice-6-integrations`. Scope: connect a
> SOURCE_REPOS integration behind a deterministic stub + import .feature files into the Test Lab; the raw token
> is never persisted (only a vault ref). Owner decisions S6-A..D.

---

## 0. Owner decisions S6

Owner picked **Integrations (connect a Git repo)** as slice 6. Following the slice-4/5 stub pattern:
- **S6-A — Deterministic stub `RepoProvider` [S6-NEW port].** Connecting/listing/importing run against a
  deterministic, offline `MockRepoProvider` (no OAuth/network). Real GitHub/GitLab/Bitbucket/ADO OAuth +
  webhooks + the other integration groups (PROJECT_TRACKING/TEST_MANAGEMENT/COMMUNICATION/CICD/DEVICES) are
  deferred. Scope = **SOURCE_REPOS** only (`github, gitlab, bitbucket, ado_repos`).
- **S6-B — Secret hygiene.** The raw token is **never** persisted, logged, returned in any View, or written to
  audit metadata — only a synthetic **`secretRef`** (`vault://{orgId}/{key}`). The stub verifies the token then
  **discards** it (the deterministic provider never needs it back), via a minimal `SecretVault.put` [S6-NEW port]
  (no `get()`). Mirrors the GenerateDrafts "never store the raw prompt" precedent.
- **S6-C — Keystone-aligned surface + one explicit extension.** Connect/disconnect/config all route through the
  single keystone mutator `PATCH /orgs/{orgId}/integrations/{key}` (intent in the body). The repo **feature
  import** is **[S6-NEW]** (not a keystone path) — `POST /projects/{id}/repo/import`, recorded here explicitly.
- **S6-D — Lifecycle = upsert-on-PATCH.** An org starts with zero `Integration` rows; `List` merges the static
  SOURCE_REPOS catalog against connected rows; `PATCH connect` upserts a row. No change to `CompleteOnboarding`.

---

## 1. Feature intent

Let an org **connect a source-code repository** and **import its `.feature` files into the Test Lab**, so the
agents author/run tests against the user's real codebase — behind the keystone `Integration` model and a
deterministic `RepoProvider` stub (the real provider lands later with zero UI/domain change).

---

## 2. Scope

### In scope
- **`Integration`** (keystone): per-org connection record for SOURCE_REPOS keys, `connected`, `secretRef`,
  `config`, `connectedById/At`. `Unique(orgId,key)`.
- **`RepoProvider` [S6-NEW port]** + `MockRepoProvider` stub — `verify` (reject empty token / unknown key),
  `listRepos`, `listFeatureFiles` (deterministic `.feature` files).
- **`SecretVault` [S6-NEW port]** + `StubSecretVault` — `put(scope, secret) -> secretRef` (discards the secret,
  returns `vault://{scope}`).
- **Use cases** — `ListIntegrations` (member view: static catalog ⨝ connected rows), `ConnectIntegration` /
  `DisconnectIntegration` (OWNER/ADMIN; verify → vault.put → upsert row; audit **without** the token),
  `ImportRepoFeatures` [S6-NEW] (author; looks up the connected SOURCE_REPOS integration by **`project.orgId`**,
  pulls `.feature` files, **upserts Features by path** (idempotent re-import), sets the Project's
  `repoProvider`(mapped `ado_repos→ado`)/`repoFullName`/`repoBranch`/`repoLastSyncAt`; UoW-atomic).
- **api** — `GET /orgs/{orgId}/integrations`, `PATCH /orgs/{orgId}/integrations/{key}`,
  `POST /projects/{id}/repo/import` [S6-NEW]; both persistence wirings; `MockRepoProvider`+`StubSecretVault`.
- **web** — an Integrations screen (`/integrations`): the SOURCE_REPOS catalog with connect/disconnect; the repo
  import control on a project.
- Cross-cutting: per-`orgId` isolation (non-member → NOT_FOUND); RBAC (OWNER/ADMIN mutate, member views);
  CSRF on mutations; RFC9457 errors; **no raw secret anywhere**.

### Out of scope (deferred)
- Real provider OAuth/PAT exchange + webhooks + repo sync/push; the non-SOURCE_REPOS groups; a real Key Vault
  with `get()`; pushing results back to the repo; per-file diff/merge; branch/commit selection UI beyond a field.

---

## 3. Domain model (keystone names verbatim)

- **`Integration`** — `id, orgId, key, group:IntegrationGroup, connected, secretRef?, config(json),
  connectedById?, connectedAt?`. `IntegrationGroup` = `SOURCE_REPOS | …` (keystone §1). Keys (keystone §8):
  `github, gitlab, bitbucket, ado_repos` (all SOURCE_REPOS).
- Pure domain [S6-NEW]: `SOURCE_REPO_CATALOG` (the 4 keys + display names), `repoProviderForKey(key)`
  (`ado_repos→'ado'`, else identity) → `Project.repoProvider` value.

### Ports
- `RepoProvider` [S6-NEW] — `verify(i:{key,token}) -> {account}` (throws on empty token / unknown key);
  `listRepos(i:{key,secretRef}) -> RepoInfo[]`; `listFeatureFiles(i:{secretRef,fullName,branch}) -> RepoFile[]`.
- `SecretVault` [S6-NEW] — `put(scope, secret) -> string` (returns `vault://{scope}`, discards `secret`).
- `IntegrationRepository` [S6-NEW] — `listForOrg(orgId)`, `findByKey(orgId,key)`, `upsert(rec)`.

---

## 4. API (keystone §6 + one S6 extension)

| Method · Path | Use case | Auth |
|---|---|---|
| `GET /orgs/{orgId}/integrations` | `ListIntegrations` (catalog ⨝ connected) | member |
| `PATCH /orgs/{orgId}/integrations/{key}` | `ConnectIntegration` / `DisconnectIntegration` (body `{action,token?,config?}`) | OWNER/ADMIN |
| `POST /projects/{id}/repo/import` **[S6-NEW]** | `ImportRepoFeatures` (`{fullName,branch}`) | OWNER/ADMIN/MEMBER |

`IntegrationView` = `key, group, connected, config, connectedAt` — **never** `secretRef`/token. Errors via
`DomainExceptionFilter` → RFC9457.

---

## 5. Acceptance criteria

- **AC-INT-01** — `ListIntegrations` returns the SOURCE_REPOS catalog (4 keys) with `connected=false` for an org
  that has connected nothing; a connected key shows `connected=true` + `connectedAt`.
- **AC-INT-02** — `PATCH …/{key}` `{action:'connect',token}` (OWNER/ADMIN) verifies the token, stores a
  `secretRef` (never the raw token), sets `connected=true`, and audits — with **no token** in the audit/View.
- **AC-INT-03** — Connecting with an empty token, or an unknown key, is rejected (`422`).
- **AC-INT-04** — `PATCH …/{key}` `{action:'disconnect'}` sets `connected=false` and clears the `secretRef`.
- **AC-INT-05** — Authz: a non-member gets `NOT_FOUND`; a member (non-admin) gets `FORBIDDEN` on connect.
- **AC-INT-06** — `POST /projects/{id}/repo/import {fullName,branch}` pulls `.feature` files from the connected
  repo and creates parsed Features in the project; the Project's `repoProvider`/`repoFullName`/`repoBranch`/
  `repoLastSyncAt` are set.
- **AC-INT-07** — Re-import is **idempotent**: importing the same repo again upserts Features by path (no dupes).
- **AC-INT-08** — Import requires a **connected** SOURCE_REPOS integration on the project's org (else `409`/
  `VALIDATION`); the integration is resolved by `project.orgId`, never a client-supplied org.
- **AC-INT-09** — The raw token never appears in any response body, View, list, audit metadata, or log.

---

## 6. Non-functional

- **Security (S6-B):** secrets are vault refs only; OWNER/ADMIN gate on connect/disconnect; per-`orgId`
  isolation; OWASP ASVS L2; CSRF on mutations.
- **Clean Architecture:** use cases depend only on ports (`IntegrationRepository`, `RepoProvider`, `SecretVault`,
  `UnitOfWork`, repos, `Clock`, `IdGenerator`); adapters wired in `apps/api`. Domain stays framework-free.
- **Determinism:** the stub provider/vault are pure/offline; identical inputs → identical results, so
  connect/import are testable without a network.
