# Gilgamesh — Staging deploy (Azure Container Apps) — Design

> First deployed environment for the platform. Supersedes the "no cloud env until the owner asks"
> gate of `azure-environments.md` §0 — **the owner asked (2026-07-06 PM4)** and made the four
> decisions in §0 below. Adheres to the Keystone (`specs/_keystone/foundation-vocabulary.md`);
> introduces **no** keystone vocabulary, entities or routes. Companion artifacts: `infra/bicep/*`
> (to be updated to v2 by this spec), `Dockerfile` + `docker/entrypoint.sh` (new), and the runbook
> in §8. Status: v0.1 — 2026-07-06.

---

## 0. Owner decisions (2026-07-06 PM4, recorded in decisions-log "Staging deploy")

| # | Decision | Choice |
|---|----------|--------|
| SD-1 | Platform | **Azure Container Apps** (the foundation bicep track, decisions-log #11) |
| SD-2 | Vault posture | **Prod-like**: `NODE_ENV=production` + real Azure Key Vault + Managed Identity. `VAULT_MODE=offline` never reaches staging. |
| SD-3 | Web hosting | **The API serves the built SPA** (single container, single origin — `__Host-` cookies + CSRF double-submit work unchanged) |
| SD-4 | Deploy execution | **Owner runs `az login` in-session; the agent executes the az commands under supervision** (relaxes the foundation "agent never deploys" contract for this objective; the runbook in §8 stays authoritative for manual re-runs) |

Two standing facts that shape everything below (from the S20 security inversion):
only the secret vault refuses to boot without config; every other provider degrades to its
deterministic stub when its env is absent (BRAIN/PAYMENTS/EMAIL/SSO/embeddings).

## 1. Current-state gaps this spec closes

1. `infra/bicep/*` is foundation-era **design-only** and drifted from the app: env names don't
   match (`LLM_API_KEY` vs `ANTHROPIC_API_KEY`, `KEY_VAULT_URI` vs `AZURE_KEY_VAULT_URL`, `PORT`
   vs `API_PORT`), no web hosting, no `/health` probes, and it provisions Service Bus + Blob +
   workers/chaos-proxy/plugin/omnipizza that nothing uses yet (keystone §7 still
   `BLOCKED-UNTIL-DELIVERED`).
2. **No Dockerfile exists** anywhere in the repo; `apps/api` has no build script (dev runs via
   `@swc-node/register`).
3. The SPA needs same-origin hosting (SD-3) — the API cannot serve static files today.
4. No migration/seed story outside a developer shell (`db:deploy` is manual).

## 2. Target topology (staging)

```
rg-gilgamesh-staging
 ├─ UAMI (workload identity: ACR pull + KV refs + KV data-plane for S20 SecretVault)
 ├─ Log Analytics (30d retention, 1 GB/day cap)
 ├─ ACR Basic (image gilgamesh-app, built with `az acr build`)
 ├─ Key Vault  ── secrets: db-connection-string · session-secret · anthropic-api-key (placeholder)
 │               + the S20 app-managed `vault://` secrets (BYOK etc.) at runtime
 ├─ Postgres Flexible B1ms + pgvector (azure.extensions allowlist VECTOR; stoppable)
 └─ Container Apps env (consumption)
     └─ app  ── ONE container: API + built SPA (WEB_DIST_DIR)
                external HTTPS ingress (managed cert) · probes on /api/v1/health
                (the global prefix has no exclusions — bare /health does not exist in prod)
                minReplicas 0 · maxReplicas 1  ← in-memory rate-limit/SSO-state stay correct
```

Explicitly **not** provisioned (param-gated off in bicep v2, re-enable when TOM lands):
Service Bus, Blob, workers, chaos-proxy, plugin-playwright, omnipizza. **No Redis**: with one
replica the in-memory `RateLimitStore` and `SsoStateStore` are correct; Redis returns as a
requirement the day staging needs >1 replica (documented invariant: `maxReplicas: 1` and
"no `REDIS_URL`" must change together).

## 3. Code changes (the only app-code deltas) — SPA serving + entrypoint + optional REDIS_URL

**`REDIS_URL` became optional in `loadConfig`** (review round, streams B+C found the hard
requirement): absent → the rate-limit and SSO-state stores select their in-memory adapters
(they always did, by presence) and the production boot logs a WARN. Correct ONLY single-replica —
the §2 invariant. A whitespace-only value is trimmed to absent in the store factories too.

**`WEB_DIST_DIR` (env, absent = feature off, zero behavior change for dev/tests/harnesses):**
when set, the API serves the vite build output:

- `GET /assets/*` → immutable cache (`Cache-Control: public, max-age=31536000, immutable`).
- `GET /` and any **GET** route that is not `/api/v1/*` and not `/health` → `index.html`
  (`Cache-Control: no-cache`) — the SPA router fallback.
- `/api/v1/*` and `/health` are **never** intercepted: an unknown API path keeps returning the
  RFC9457 JSON 404, never HTML. Non-GET methods are never intercepted. (Prod health lives at
  `/api/v1/health`; bare `/health` is deliberately excluded so a mispointed probe/monitor fails
  loudly with a JSON 404 instead of getting a fake-green 200 `index.html` — review A F1.)
- Missing/unreadable `WEB_DIST_DIR` at boot with the flag set = fail-fast boot error (misconfig
  must not silently ship an API-only staging).

Tests (TDD, api e2e/supertest): serves `index.html` at `/`; serves a real asset with the immutable
header; client route (`/projects/x/lab`) falls back to `index.html`; `/api/v1/nonexistent` stays
RFC9457 404 JSON; `/health` stays JSON; flag absent → `/` behaves exactly as today. BDD/Cucumber is
not extended — this is infra plumbing below the product's acceptance surface; the container smoke
(§6) plays the acceptance role.

**Container entrypoint** (`docker/entrypoint.sh`): `prisma migrate deploy` (fail = container fails
visibly in Log Analytics) → `node -r @swc-node/register src/main.ts`. The `KnowledgeSeeder`
auto-seeds sample chunks if the store is empty (existing behavior); the full `ingest:corpus` is a
manual post-deploy step (§8).

## 4. Docker image

Multi-stage, one image `gilgamesh-app`:

1. **build stage** (node:22 + corepack/pnpm): `pnpm install --frozen-lockfile` → `prisma generate`
   → `pnpm --filter @gilgamesh/web build` (vite outputs `apps/web/dist`).
2. **runtime stage** (node:22-slim + openssl for Prisma): workspace sources + node_modules +
   `apps/web/dist` + entrypoint; runs as non-root; `NODE_ENV=production`,
   `WEB_DIST_DIR=/app/apps/web/dist`, `API_PORT=3001`.

Runtime executes TS via `@swc-node/register` — same mechanism as `start:dev`, honest and known to
work with the tsconfig-paths workspace layout. The image is fat (~1 GB); an AOT-compiled build
(tsup/Nest build) is a recorded follow-up, **not** a staging blocker. Native deps
(`@node-rs/argon2`, `@swc/core`) resolve to linux binaries because install happens in the linux
build stage.

**Local validation before Azure (gate):** `docker-compose.staging.yml` (own compose project
`gilgamesh-staging` — review B F1: it must never reconcile the dev project) boots the Redis-less
stack — `app` (the image, with a node-fetch healthcheck) + `postgres` — via
`up -d --build --wait`, and the Playwright staging smoke (SPA at `/`, register→onboarding→agent
room, authed same-origin round-trip, JSON 404 under `/api/v1`, deep-link fallback) runs against
`http://localhost:3001`. Azure is touched only after this is green. **[VALIDATED 2026-07-07:
container Healthy, smoke 1/1 passed.]**

## 5. Bicep v2 + env matrix

`infra/bicep/` updated in place: keep modules `keyVault`/`postgres`/`containerApps`; add
`env=staging` naming; add `deployRunners=false` + `deployServiceBus=false` + `deployBlob=false`
params (default off); Postgres module must set `azure.extensions = VECTOR`; containerApps module
reduced to the single `app` (probes `/health`, scale 0..1, ingress external, `transport: auto`).

| Env var | Staging value | Source |
|---|---|---|
| `NODE_ENV` | `production` | literal |
| `API_PORT` / `WEB_DIST_DIR` | `3001` / `/app/apps/web/dist` | image |
| `DATABASE_URL` | secretRef `db-connection-string` (`sslmode=require`) | KV |
| `SESSION_SECRET` | secretRef `session-secret` (generated at deploy) | KV |
| `SHUTDOWN_GRACE_MS` | `20000` (20s — see the drain contract below) | literal |
| `AZURE_KEY_VAULT_URL` | vault URI | bicep output |
| `AZURE_CLIENT_ID` | UAMI client id (DefaultAzureCredential) | bicep |
| `CORS_ORIGINS` | *(empty — same origin)* | literal |
| `ANTHROPIC_API_KEY` | secretRef `anthropic-api-key` — bound **only** when a real key was supplied at deploy (see caveat below); otherwise the env var is absent | KV |
| `REDIS_URL`, `VOYAGE_API_KEY`, `STRIPE_*`, `SMTP_URL`/`EMAIL_FROM`, `GOOGLE_*`, `BRAIN_MODEL_*` | **absent** | activate later via `az keyvault secret set` + revision restart |
| any `*_MODE` | **absent** | offline pins are for tests only; staging uses real-or-degrade |

Caveat (S9 selector): `ANTHROPIC_API_KEY` bound to a placeholder value selects the **real** brain
with an invalid key. The bicep binds the env var **only when** the owner supplied a real key at
deploy (`empty(anthropicApiKey)` guard); until then the var is absent and the stub answers — the
degradation contract stays intact.

**Graceful-shutdown drain contract (slice 29 × slice 27 — F4 invariant).** Zero-downtime rollouts
depend on three values lining up: `readiness detect (periodSeconds × failureThreshold) < SHUTDOWN_GRACE_MS
< ACA terminationGracePeriodSeconds`. On SIGTERM the app flips `/api/v1/health/ready` to 503; ACA must
*observe* not-ready and stop routing **before** `app.close()` fires. The `containerApps.bicep` readiness
probe is `periodSeconds 5 × failureThreshold 3 = 15s` and `SHUTDOWN_GRACE_MS=20000` (20s), under ACA's
default `terminationGracePeriodSeconds` of 30s → **15s < 20s < 30s** (~5s of drain margin, ~10s before
SIGKILL). This was mis-set at first: the readiness probe was `10×3 = 30s` against the app's default 10s
grace, so `app.close()` would have fired long before ACA saw not-ready and the drain would have been a
**no-op on ACA** despite green app-level tests. If you retune the readiness probe or the grace, re-check
the inequality — and never lower ACA's termination grace below `SHUTDOWN_GRACE_MS`.

## 6. Anthropic / Voyage account posture (owner Q&A 2026-07-06)

- **Claude Max does not back the API** — it is a consumer subscription (claude.ai/Claude Code),
  carries no API credits, and its credentials must not be wired into a product backend.
  `ClaudeBrain` needs an **Claude Console** (platform.claude.com) API key: separate account,
  prepaid usage-based credits.
- **Recommended Console setup:** workspace `gilgamesh-staging` → API key scoped to it → monthly
  spend limit (~US$10–20). Prod later = its own workspace/key/limit. The key lands in Key Vault
  (`anthropic-api-key`), never in the repo or bicep params files committed to git.
- **Multi-team scale is already product-level:** platform key = shared pool metered by
  `BrainUsage` and capped per-org by S14 token billing (FREE 100k · STARTER 2M · GROWTH 10M ·
  SCALE ∞); big tenants bring their own key via S9 BYOK (vaulted, per-call resolution) and pay
  Anthropic directly. Console rate-limit tiers grow with accumulated spend; staging fits the
  first tier.
- **Embeddings are Voyage, not Anthropic** — semantic retrieval requires a separate Voyage AI
  account/key; absent it staging stays on the deterministic lexical hash (S16/S19 coherence gate).

## 7. Method & gates

- F1 code in worktree **`feat-staging-deploy`** (`pnpm wt`, announced) → adversarial review →
  full gates fresh + foreground (typecheck · lint · 918+ Docker-free · `test:int` 23 · BDD 198 ·
  Playwright 18) → FF merge. No schema change ⇒ no `db:deploy`/`prisma generate` step needed
  post-merge, but the checklist runs anyway (standing rule).
- F2 image: local compose boot + container smoke green **before** any az command.
- F4 deploy: owner `az login` → agent executes → post-deploy smoke against the staging URL
  (register → login → onboarding → lab → run → chat stub → knowledge search) + `/api/v1/health`
  200 + cookie flags (`__Host-`, Secure) verified on the real HTTPS origin.

## 8. Deploy runbook (F4 — also valid for manual re-runs)

The container app references an image that must already exist in ACR, so the first deploy is
**two-phase** (bicep param `deployApp`, default `false`, gates the Container Apps env + app):

```sh
az login                                    # OWNER (interactive)
az group create -n rg-gilgamesh-staging -l eastus2
# Phase 1 — platform resources only (identity, LAW, ACR, KV, Postgres); no app yet:
az deployment group create -g rg-gilgamesh-staging -f infra/bicep/main.bicep \
  -p env=staging -p deployApp=false \
  -p postgresAdminPassword=<gen> -p sessionSecret=<gen> [-p anthropicApiKey=...]
# Phase 2 — build the image in the cloud (no local docker needed). Multi-tag so the template's
# :latest fallback always resolves (review C D3):
az acr build -r <acr> -t gilgamesh-app:<gitsha> -t gilgamesh-app:latest -f Dockerfile .
# Phase 3 — same template, now with the app on the freshly pushed image:
az deployment group create -g rg-gilgamesh-staging -f infra/bicep/main.bicep \
  -p env=staging -p deployApp=true -p appImage=<acr>.azurecr.io/gilgamesh-app:<gitsha> \
  -p postgresAdminPassword=<gen> -p sessionSecret=<gen> [-p anthropicApiKey=...]
# Subsequent code rollouts: az acr build + az containerapp update --image <new tag>.
# Optional, later, one at a time:
az keyvault secret set --vault-name <kv> --name anthropic-api-key --value sk-ant-...
az containerapp revision restart ...
pnpm --filter @gilgamesh/api ingest:corpus   # full RAG corpus (DATABASE_URL → staging, run locally)
az postgres flexible-server stop ...         # park the DB when idle (cost)
```

**Stopped-Postgres rules (review C D2/D4):** `az postgres flexible-server start` BEFORE (a) any
full-template `az deployment group create` re-run (ARM PUT on a stopped server fails the whole
deployment — prefer `az containerapp update` for image/env-only changes) and (b) waking the app
after an idle stop (otherwise `migrate deploy` crash-loops visibly until the DB is up).

Secrets policy: `postgresAdminPassword`/`sessionSecret` generated at deploy time (CSPRNG), passed
as secure params, stored only in KV. Nothing secret is committed; `.bicepparam` files with secrets
are gitignored.

## 9. Risks / accepted tradeoffs

| Risk | Position |
|---|---|
| Scale-to-zero cold start (~seconds) | Accepted for staging; set `minReplicas: 1` later if it annoys |
| ACA ingress idle timeout vs chat SSE | S9 heartbeat + web one-shot resync already mitigate; verify in smoke |
| swc-node runtime (no AOT build) | Accepted; follow-up: compiled build + slim image |
| Single replica | By design (§2 invariant); Redis + multi-replica is a future, separate change |
| pgvector on Flexible Server | `azure.extensions=VECTOR` verified in F3; migration `CREATE EXTENSION vector` runs via entrypoint `db:deploy` |
| Placeholder key selecting the real brain | Closed by the §5 `empty()` guard |

## 10. Out of scope (recorded follow-ups)

CD via GitHub Actions OIDC (after the first manual deploy) · prod environment · custom domain
(staging uses the ACA-managed `*.azurecontainerapps.io` cert/URL) · Redis + multi-replica ·
compiled runtime image · TOM runners/Service Bus re-enable · `BRAIN_SMOKE` live-key smoke.
