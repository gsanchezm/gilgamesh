# Gilgamesh — QA Environments (Azure + Local) — Design

> Foundation infra design for the Gilgamesh multi-tenant QA platform. **DESIGN ONLY.**
> Adheres to the Keystone (`specs/_keystone/foundation-vocabulary.md`) verbatim for entity, port,
> enum and integration-key names. Authority: decisions-log **#11 (QA environment, two-track)**,
> cross-cutting mandates (performance first-class, security primordial, multi-tenant cost-efficiency).
> Companion declarative templates: `infra/bicep/main.bicep` + `infra/bicep/modules/*.bicep`.
> Status: v0.1 — 2026-06-29.

---

## 0. Scope, ownership & cost gating (read first)

- **One small QA environment. No prod.** This is the only cloud environment in the foundation.
  A prod/staging topology is explicitly out of scope until the owner asks for it.
- **The owner performs Azure auth, not the agent.** The agent **cannot** run `az login`, enter
  subscription credentials, or apply Bicep. Concretely: the agent authors `infra/bicep/*` and the
  one-command deploy runbook (§11); the **owner** runs `az login`, selects the subscription, and
  runs the deploy.
- **Cloud cost begins only on deploy.** Nothing in this repo incurs Azure charges. The Bicep is a
  contract on disk. Cost starts the moment `az deployment group create` provisions resources, and the
  owner decides *when* that happens (decisions-log #11, RESOLVED: "write the Bicep now; deploy when
  owner says so — no cloud cost until deploy").
- **Two-track QA** (decisions-log #11):
  - **Local docker-compose** — the day-to-day fast TDD/BDD loop (§9). Zero cloud cost, always available.
  - **Azure QA via Bicep** — a shared, internet-reachable QA env for integration/e2e/demo, provisioned
    only when needed and built to idle at ~$0 (scale-to-zero) between uses.

---

## 1. Design drivers (from the mandates)

| Driver | How this design honors it |
|--------|---------------------------|
| **Performance first-class** | Scale-to-zero with fast wake; KEDA queue-depth autoscaling; budgets in §8 enforced in CI; Postgres B1ms sized for QA with auto-grow; Blob lifecycle to keep hot set small; gRPC (http2) between kernel and plugins. |
| **Security primordial (OWASP ASVS L2)** | One workload **Managed Identity** for every app — **no connection strings/keys in env**; Key Vault references for all secrets; **Artifacts only via signed expiring URLs, never public**; Storage shared-key disabled; Key Vault RBAC + purge protection; TLS 1.2 floor; private-networking switch; audit via `AuditLog`. |
| **Multi-tenant cost-efficiency** | Single shared QA env, Consumption Container Apps (idle ~$0), Burstable Postgres, LRS storage, Basic ACR, daily Log-Analytics cap, lifecycle-expired artifacts. Tenant isolation is **row-level by `orgId`** (app layer) on shared infra — the cost-efficient SaaS model (keystone §0). |

> **Tenant isolation note.** Per keystone §0 every tenant-scoped row carries `orgId`, enforced in
> **every query** (row-level). The cloud infra is *shared* across tenants by design (one DB, one
> storage account, one Service Bus). Infra does not weaken isolation — it is enforced in the
> `@gilgamesh/application` + Prisma repository layer, and audited. This is the standard, cost-efficient
> multi-tenant SaaS posture the decisions-log calls for.

---

## 2. Topology (Azure QA)

```
                       ┌──────────────────────────── Resource Group: rg-gilgamesh-qa ─────────────────────────────┐
                       │                                                                                           │
 Internet ──HTTPS──▶  api (Container App)                    Workload User-Assigned Managed Identity               │
                       │   external ingress, scale 0→3        (ACR pull · KV refs · Blob SAS · SB · Postgres)      │
                       │      │ SSE /runs/{id}/events                    ▲         ▲          ▲         ▲           │
                       │      │ enqueue Run                              │         │          │         │           │
                       │      ▼                                         pull     secrets    blobs    send/recv      │
                       │  Service Bus  ── queue 'runs' ─────────────────┼─────────┼──────────┼─────────┘           │
                       │  (EventBus)   ── topic 'run-events' ◀── SSE     │         │          │                     │
                       │      │ KEDA queue-depth scaler                  │         │          │                     │
                       │      ▼                                          │         │          │                     │
                       │  workers (Container App, scale 0→4) ──gRPC──▶ chaos-proxy (:50051, scale 0→2)              │
                       │      │ kernel.run(plan)                                   │ gRPC                            │
                       │      │                                                    ▼                                │
                       │      │                                          plugin-playwright (scale 0→2) ──▶ omnipizza│
                       │      ▼                                                    │ emits VIDEO/SHOT/HAR           │
                       │  Postgres Flexible (B1ms + pgvector)                      ▼                                │
                       │  (all entities + KnowledgeChunk vectors)        Blob Storage 'artifacts' (private)         │
                       │                                                  ▲ signed expiring URL (User-Delegation SAS)│
                       │  Azure Container Registry (Basic)    Key Vault (RBAC) ── secrets · Integration tokens · LLM│
                       │  Log Analytics (Container Apps logs)                                                       │
                       └───────────────────────────────────────────────────────────────────────────────────────────┘
```

Owner-delivered runners (`chaos-proxy`, `plugin-playwright`, `omnipizza`) are **keystone §7
BLOCKED-UNTIL-DELIVERED** — their Container Apps exist but stay at **0 replicas** until real images
are pushed to ACR and a Run is enqueued. Everything else (auth, onboarding, agent room, test-lab
authoring, integrations, subscription, knowledge upload) runs without them.

---

## 3. Infra → Keystone port/entity mapping (the contract)

| Keystone item | Azure resource | Notes |
|---------------|----------------|-------|
| §4 `apps/api` (NestJS) | Container App `api` | External HTTPS ingress; HTTP-concurrency scaler; scale 0→3. |
| §4 `apps/workers` (BullMQ) | Container App `workers` | **Cloud broker = Service Bus** (see §6 port seam); KEDA queue scaler; scale 0→4. |
| §7 `chaos-proxy` (:50051) | Container App `chaos-proxy` | Internal gRPC (http2); owner-delivered image. |
| §7 Playwright plugin | Container App `plugin-playwright` | Internal gRPC; owner-delivered; 1 vCPU/2 GiB (browser). |
| §7 OmniPizza SUT | Container App `omnipizza` | Internal HTTP; owner-delivered sample target. |
| §5 `ArtifactStorage.put/signedUrl` | Blob Storage `artifacts` container | `signedUrl(key, ttlSec)` = **User-Delegation SAS**; container private. |
| §2 `Artifact` (VIDEO/SCREENSHOT/HAR/LOG/REPORT_HTML, `storageKey`) | Blob object under `artifacts/` | `meta(json)` stays in Postgres; bytes in Blob. |
| §2 `KnowledgeDoc.storageKey` | Blob `knowledge` container | Uploaded RAG sources, private. |
| §2 `KnowledgeChunk.embedding vector(1536)` | Postgres + **pgvector** | `azure.extensions=VECTOR` allowlisted in `postgres.bicep`. |
| §5 `EventBus.publish/subscribe(topic)` | Service Bus topic `run-events` | RunEvent fan-out → api SSE `/runs/{id}/events`. |
| run queue (enqueue Run) | Service Bus queue `runs` | KEDA trigger for workers + runners. |
| §2 `Integration.secretRef` (NEVER raw token) | Key Vault secret | Per-integration token referenced by KV URI, never stored raw (§8 keys: github…browserstack). |
| §5 `AgentBrainPort` (Claude default) | Key Vault secret `llm-api-key` | Provider-agnostic; key never in env, only KV ref. |
| §0 session cookie auth | Key Vault secret `session-secret` | httpOnly session signing key (slice-1 local auth). |
| all §2 entities | Postgres database `gilgamesh` | snake_case tables; `orgId`-indexed; row-level isolation. |
| §2 `AuditLog` | Postgres table + Log Analytics | Sensitive-action audit; infra logs to Log Analytics. |

---

## 4. Container Apps (api · workers · runners) — scale-to-zero / KEDA

`infra/bicep/modules/containerApps.bicep`. Consumption plan; **every app `minReplicas: 0`**.

- **api** — external HTTPS (managed cert), `targetPort` = `apiPort` (3000, parameterized). Reads
  `db-connection-string`, `llm-api-key`, `session-secret` as **Key Vault references** (not plaintext).
  Serves `/api/v1/*`, the SSE stream `/runs/{id}/events`, and returns signed Blob URLs from
  `/artifacts/{id}`.
  - **⚠ SSE vs HTTP-concurrency scaler (perf-review MED).** Long-lived SSE connections inflate the
    built-in HTTP-concurrency metric: the api would scale on *streaming* load rather than request load,
    and **scale-to-zero is blocked whenever any stream is open**. Mitigations (apply both):
    1. **Route SSE off the concurrency metric** — either a **separate revision/scale rule** for
       `/runs/{id}/events` (scale on a custom active-run / queue-depth metric, KEDA), or **exclude
       `text/event-stream` from the HTTP concurrency target** so only request traffic drives autoscale.
    2. **Graceful drain on scale-in** — a scale-in event drops active SSE connections on the terminating
       replica; honor `terminationGracePeriodSeconds`, send `event: end`, and let clients reconnect with
       `Last-Event-ID` against a **durable replay source** (§6 — the per-replica-subscription + DB
       snapshot, since Service Bus cannot replay).
- **workers** — no ingress. Scaler: **KEDA `azure-servicebus`** on queue `runs` (`messageCount` per
  replica, parameterized). Consumes Run jobs, calls `@gilgamesh/kernel` → `chaos-proxy` over internal
  gRPC, publishes `RunEvent`s to the `run-events` topic.
- **chaos-proxy** — internal gRPC ingress (`http2`) on `:50051` (keystone §7). KEDA on `runs` so it is
  present while a Run is active, zero when idle. **Owner-delivered image.**
- **plugin-playwright** — internal gRPC plugin server; 1 vCPU / 2 GiB (browser engines). **Owner-delivered.**
- **omnipizza** — internal HTTP sample SUT for runners to hit. **Owner-delivered.**

Wake path: `POST /projects/{id}/runs` → api enqueues to `runs` → KEDA scales workers + chaos-proxy +
plugin from 0 → run executes → artifacts to Blob, events to topic → SSE to the canvas → all scale back
to 0. Idle compute cost ≈ $0.

**Inter-app addressing** uses the Container Apps environment internal DNS (`chaos-proxy`,
`plugin-playwright`, `omnipizza` as hostnames) — no public exposure of runners.

---

## 5. Postgres Flexible Server (+ pgvector)

`infra/bicep/modules/postgres.bicep`. Backs every keystone §2 entity and the RAG vectors.

- **SKU** Burstable **B1ms** (1 vCPU / 2 GiB), 32 GiB auto-grow, Postgres 16, **no HA**, **no geo-redundant
  backup**, 7-day PITR. Cheapest tier that runs the platform for QA.
- **pgvector** — `azure.extensions=VECTOR,PG_TRGM,UUID-OSSP` allowlisted so the app can
  `CREATE EXTENSION vector` for `KnowledgeChunk.embedding vector(1536)` (tenant-scoped retrieval).
- **Auth** — password mode is the wired default; the password is a `@secure()` param copied into Key
  Vault as `db-connection-string` (apps read it as a KV reference). **Entra-ID auth is enabled** on the
  server (`activeDirectoryAuth: Enabled`) as the ASVS-L2 hardening path; wiring the workload identity as
  an AAD DB principal for password-less access is a documented follow-on (§12).
- **Network** — public+firewall mode by default (`AllowAllAzureServicesAndResources` rule only — not the
  open internet). Private/VNet mode via `delegatedSubnetId` + `privateDnsZoneId` when
  `enablePrivateNetworking` is on.
- **Connection pooling (REQUIRED — perf-review MED).** `api` (0→3) and `workers` (0→4) each hold a Prisma
  connection pool and scale **horizontally** against a single B1ms whose `max_connections` ceiling is
  small (~35–50). Without a pooler the combined pools exhaust connections under load — a throughput cliff
  no perf budget catches until it fails. Put **PgBouncer in transaction-pooling mode** in front of
  Postgres (Azure Flexible Server's **built-in PgBouncer**, `pgbouncer.enabled=true`, or a sidecar), cap
  each app's Prisma `connection_limit`, and hold the invariant **`replicas × per-app connection_limit +
  headroom (session sweep, migrations) ≤ server max_connections`**. (Note Prisma in transaction mode:
  `pgbouncer=true` on the connection string to disable prepared-statement caching.)
- **Idle cost caveat** — Flexible Server has **no scale-to-zero**; it is the dominant idle cost. See §7.

---

## 6. Service Bus — message broker (run queue + EventBus)

`infra/bicep/modules/serviceBus.bicep`.

- **queue `runs`** — enqueued Run jobs; **KEDA scaler trigger** for workers + runners. 5-min lock
  (long dispatch), dead-letter on expiry, max 5 deliveries.
- **topic `run-events`** — live `RunEvent` fan-out (`NODE_STATE`/`LOG`/`ARTIFACT`/`SUMMARY` — keystone
  §5) to the api, which relays over SSE to the orchestration canvas. 1-hour TTL (ephemeral).
  - **⚠ Broadcast-correctness (perf-review HIGH).** A **single** subscription `api-sse` is
    **competing-consumer**: with `api` scaled 0→3 each `RunEvent` is delivered to **exactly one** api
    replica, so a viewer whose SSE connection landed on a different replica never sees it — broadcast
    fan-out is broken, and `Last-Event-ID` replay is unimplementable (Service Bus is not a replayable
    log). The adapter MUST satisfy the **port-level fan-out contract** pinned in
    `run-lifecycle.md` §10.5 (broadcast + resume) by ONE of:
    - **per-replica subscription** — each api replica creates its own subscription on `run-events` at
      startup (deleted on shutdown) so it receives a full copy of every event; **plus a DB-backed
      snapshot for replay** (re-read `RunNode` states + a bounded per-run `RunEvent` journal) so
      `Last-Event-ID` resumes from durable rows, not the broker; **or**
    - **a replayable log** transport — **Azure Event Hubs** (or **Redis Streams via Azure Cache**)
      standing in for the topic, giving native multi-consumer offsets + replay.
  - The "drop to Basic / Postgres `LISTEN/NOTIFY`" fallback below has **neither durability nor replay**
    and does not satisfy the contract on its own (it needs the same DB-snapshot replay).
- **SKU** `Standard` (required for topics; Basic = queues only). Standard is a modest flat fee, **no
  per-replica idle compute**. Parameterized — drop to `Basic` if the EventBus topic is implemented
  off-broker (e.g. Postgres `LISTEN/NOTIFY`).
- **Auth** — `disableLocalAuth: true` (Entra-only, no SAS keys); apps + the KEDA scaler authenticate
  with the workload Managed Identity (`Azure Service Bus Data Owner`).

### Message-broker port seam (reconciling keystone §4 "BullMQ" with decision #11 "Service Bus")
Keystone §4 names **BullMQ** (Redis-backed) for `apps/workers`; decisions-log #11 mandates **Service
Bus** for the Azure QA env. These are reconciled through the **`EventBus` port (keystone §5)** plus the
run-queue abstraction:

- **Local docker-compose** → **Redis + BullMQ** adapter (matches keystone §4 and the §9 parity list).
- **Azure QA** → **Service Bus** adapter (matches decision #11; KEDA-native; **no always-on Redis**, so
  idle stays ~$0 — Azure Cache for Redis cannot scale to zero and would add a fixed monthly floor).

The worker code depends on the port, not the broker. This is called out in **Deviations** since the
keystone literally says "BullMQ"; no new keystone name is introduced — `EventBus` already exists.

---

## 7. Key Vault — secrets, integration tokens, LLM key

`infra/bicep/modules/keyVault.bicep`.

- **RBAC authorization** (no legacy access policies), **soft-delete + purge protection**, TLS 1.2.
- The workload identity gets **`Key Vault Secrets User`** (read-only) — least privilege.
- Secrets seeded at deploy (by `main.bicep` / runbook): `db-connection-string`, `session-secret`,
  `llm-api-key` (optional). **`Integration.secretRef` (keystone §2)** integration tokens
  (github/jira/slack/gha/browserstack/… — keystone §8) are written **at runtime** by the api when an
  integration is connected, and stored **only** as KV references — never raw in the DB (`secretRef` is a
  KV URI, `connected` is a bool, `config(json)` holds non-secret data only).
- **No app reads a key from env** — Container Apps `secrets[]` entries use `keyVaultUrl` + the workload
  `identity`, surfaced to containers via `secretRef` env bindings.

---

## 8. Performance budgets (enforced in CI / load checks)

First-class performance (decisions-log). Budgets for the QA env; CI fails on regression where measurable.

| Surface | Budget |
|---------|--------|
| API read (p95, warm) | ≤ 200 ms server time for list/detail (`orgId`-filtered, cursor-paginated). |
| API write (p95, warm) | ≤ 400 ms. |
| Cold start (api wake from 0) | ≤ 3 s to first byte (Consumption). Acceptable for QA; pre-warm not used (cost). |
| Run enqueue → first `NODE_STATE` event | ≤ 10 s (includes KEDA waking workers + chaos-proxy from 0). |
| SSE event delivery latency (topic → client) | ≤ 1 s p95. |
| RAG retrieval (pgvector top-k, tenant-scoped) | ≤ 150 ms p95 for k≤8 over a project corpus. |
| Signed artifact URL issuance | ≤ 100 ms p95 (User-Delegation SAS, cached delegation key). |
| Worker concurrency | KEDA: 1 replica per `queueMessagesPerReplica` (default 5) queued runs, capped at `workersMaxReplicas`. |
| Artifact upload (per object) | Streamed `put()` — no full-buffering; 100 MB video uploads without OOM. |

> Cold-start vs. cost trade: Consumption scale-to-zero means a few-second wake. For a **QA** env this is
> the right trade (idle ~$0 > always-warm). A `minReplicas: 1` "keep-warm" toggle is intentionally
> **not** set; revisit only if QA demos need instant response.

---

## 9. Local docker-compose parity (the day-to-day QA loop)

Decisions-log #11 local stack: **Postgres + Redis + MinIO + pgvector + chaos-proxy + Playwright plugin +
OmniPizza SUT**. This mirrors the Azure topology so a Run behaves identically locally and in cloud, with
**zero cloud cost**. (Illustrative — the runnable compose file is produced by the dev-tooling artifact,
not here; this documents the parity contract.)

| Local service | Azure counterpart | Port (local) | Backs |
|---------------|-------------------|--------------|-------|
| `postgres` (with `pgvector`) | Postgres Flexible + pgvector | 5432 | all entities + `KnowledgeChunk` vectors |
| `redis` | Service Bus (broker) | 6379 | **BullMQ** run queue + EventBus (local adapter) |
| `minio` | Blob Storage | 9000/9001 | `ArtifactStorage` (S3-compatible; signed URLs) |
| `chaos-proxy` | Container App `chaos-proxy` | 50051 | kernel gRPC (keystone §7) |
| `plugin-playwright` | Container App `plugin-playwright` | 50050 | Playwright plugin (keystone §7) |
| `omnipizza` | Container App `omnipizza` | 8080 | sample SUT (keystone §7) |

```yaml
# DESIGN REFERENCE ONLY — not deployed/run by this artifact.
# services:
#   postgres:   { image: pgvector/pgvector:pg16, ports: ["5432:5432"], env: POSTGRES_DB=gilgamesh }
#   redis:      { image: redis:7-alpine, ports: ["6379:6379"] }          # BullMQ broker (local)
#   minio:      { image: minio/minio, command: server /data --console-address ":9001",
#                 ports: ["9000:9000","9001:9001"] }                     # ArtifactStorage (S3 API)
#   chaos-proxy:      { image: <owner>/chaos-proxy:dev, ports: ["50051:50051"] }   # keystone §7
#   plugin-playwright:{ image: <owner>/plugin-playwright:dev }                     # keystone §7
#   omnipizza:        { image: <owner>/omnipizza:dev, ports: ["8080:8080"] }       # sample SUT
```

**Storage parity:** `ArtifactStorage` has a MinIO adapter (S3 SDK, presigned URLs) locally and a Blob
adapter (User-Delegation SAS) in Azure — same port, same `signedUrl(key, ttlSec)` semantics, never public.

---

## 10. Security model (ASVS L2 summary)

- **Identity, not secrets.** One user-assigned Managed Identity for every app; RBAC role assignments:
  `AcrPull` (registry), `Key Vault Secrets User` (KV), `Storage Blob Data Contributor` (Blob + SAS),
  `Azure Service Bus Data Owner` (SB). No SAS keys, no account keys, no DB password in env.
- **Artifacts never public.** Storage `allowBlobPublicAccess: false`, `allowSharedKeyAccess: false`;
  access only via short-TTL **User-Delegation SAS** minted by the identity-holding api/worker.
- **Secrets in Key Vault only.** RBAC vault, purge protection; `Integration.secretRef` always a KV URI.
- **Tenant isolation** is row-level by `orgId` in the app/repository layer (keystone §0) on shared infra;
  every list/detail query filters by `orgId`; sensitive actions write `AuditLog`.
- **Transport** TLS 1.2 floor everywhere; api ingress `allowInsecure: false`; internal gRPC over http2.
- **Network hardening switch** (`enablePrivateNetworking`): VNet-integrated Container Apps env +
  private Postgres; public access disabled. Off by default for QA to avoid private-endpoint hourly cost
  (§11). Blob/KV/Service Bus private endpoints are a documented follow-on (§12).
- **Logging** to Log Analytics (30-day retention, 1 GB/day cap) for forensics without prod-scale cost.

---

## 11. Cost minimization (idle ~$0 by design)

The environment is engineered so an **idle** QA env costs near nothing, and an **active** env costs only
for the minutes a Run executes.

**What is ~$0 when idle**
- **Container Apps (api/workers/runners)** — Consumption plan, `minReplicas: 0`. Billed per
  vCPU-second / GiB-second **only while active**. Idle = no replicas = no compute charge.
- **Blob Storage** — pay per GB stored + transactions; lifecycle rule tiers artifacts to **Cool** after
  7 days and **deletes** after 30 (parameterized). No idle compute.
- **Key Vault / ACR (Basic)** — negligible (per-operation / small fixed).
- **Service Bus Standard** — modest flat fee, **no per-replica compute**; the trade for topic support
  and KEDA over an always-on Redis (which cannot scale to zero).

**The dominant idle cost: Postgres** — Flexible Server has no scale-to-zero and bills while running.
Mitigations (in priority order):
1. **Stop the server when the QA env is not in use.** Flexible Server can be stopped for up to 7 days
   (`az postgres flexible-server stop`); compute billing pauses (storage still billed). This is the single
   biggest lever. The owner (or a scheduled automation) stops it after hours and starts it before a session.
2. **Burstable B1ms** — smallest viable SKU; CPU credits cover bursty QA load.
3. **No HA, no geo-redundant backup, no read replica** in QA.

**Other levers**
- **Single shared QA env, no prod** — one of everything.
- **LRS** storage redundancy (cheapest); **Basic** ACR (no geo-replication); **PerGB2018** Log Analytics
  with a **1 GB/day ingestion cap** + 30-day retention.
- **Owner-delivered runners default to 0 replicas** — they cost nothing until images exist and a Run runs.
- **No NAT gateway / no static public IP / no private endpoints** in the default tier (each is an hourly
  charge). Private networking is an opt-in hardening switch, not the default.
- **Deploy on demand, destroy when done** — `az group delete -n rg-gilgamesh-qa` returns the env to $0;
  re-deploy from Bicep in minutes. The template is the durable asset, not the running env.

> **Rough idle profile** (order-of-magnitude, region-dependent, *not a quote*): with Postgres **stopped**
> and apps at zero, idle is dominated by Service Bus Standard + minimal storage/KV/Log — i.e. a few
> dollars/month. With Postgres **running**, add the B1ms compute hours. Exact pricing is pinned by the
> owner at deploy using current rates — not quoted here.

---

## 12. Deploy runbook (OWNER runs — agent cannot)

```bash
# Prereqs the OWNER does (agent cannot): install az CLI + bicep, then authenticate.
az login                                   # interactive — owner credentials
az account set --subscription "<SUB_ID>"   # owner selects the subscription

# 1) Resource group (single QA env, no prod)
az group create -n rg-gilgamesh-qa -l eastus2

# 2) Validate the template WITHOUT provisioning (no cost) — what-if preview
az deployment group what-if -g rg-gilgamesh-qa -f infra/bicep/main.bicep \
  -p namePrefix=gilgamesh env=qa \
  -p postgresAdminPassword='<from-owner-secret-store>' \
  -p sessionSecret='<random-32B>' -p llmApiKey='<claude-key-or-empty>'

# 3) Deploy (COST STARTS HERE — owner's explicit go)
az deployment group create -g rg-gilgamesh-qa -f infra/bicep/main.bicep \
  -p postgresAdminPassword='...' -p sessionSecret='...' -p llmApiKey='...'

# 4) Push images (api/workers + owner-delivered runners) to ACR, then runs scale 0→N on demand.
#    (chaos-proxy / plugin-playwright / omnipizza are keystone §7 owner-delivered.)

# Cost controls
az postgres flexible-server stop  -g rg-gilgamesh-qa -n <pg-name>   # pause Postgres compute when idle
az postgres flexible-server start -g rg-gilgamesh-qa -n <pg-name>   # resume before a session
az group delete -n rg-gilgamesh-qa --yes                            # back to $0; re-deploy from Bicep
```

> The agent provides this runbook + the Bicep. The owner executes auth and deploy. **No cloud cost is
> incurred by anything in this repository until step 3.**

---

## 13. Deviations & extensions from the Keystone

- **Service Bus as the cloud message broker** while keystone §4 names **BullMQ** for `apps/workers`.
  Reconciled via the existing **`EventBus` port (keystone §5)** + run-queue abstraction: BullMQ+Redis is
  the **local** adapter, Service Bus is the **Azure** adapter (decisions-log #11). **No new keystone name
  introduced.** Rationale: KEDA-native autoscaling and idle ~$0 (Redis cannot scale to zero).
- **Infra resource names** (resource group, identity, ACR, Log Analytics, Container Apps env, KV,
  storage, Service Bus namespace, Postgres server) are **Azure deployment names**, not keystone domain
  names — outside the keystone's vocabulary scope. They are parameterized (`namePrefix`, `env`, unique
  suffix). Container **app** names (`api`, `workers`, `chaos-proxy`, `plugin-playwright`, `omnipizza`)
  align with keystone §4/§7 wording.
- **`apiPort` default 3000** and gRPC ports (`chaos-proxy :50051` from keystone §7; plugin `:50050`) are
  parameterized; the keystone pins only `:50051` for chaos-proxy. No conflict.
- **Documented hardening follow-ons** (not in the default cost-min tier): private endpoints for
  Blob/Key Vault/Service Bus; Entra-only Postgres auth (workload identity as AAD DB principal);
  Application Insights distributed tracing. Each adds cost and is intentionally opt-in.

### Open questions to validate on first `bicep build` (agent cannot compile / hit network)
- **KEDA managed-identity scaler placement.** `containerApps.bicep` expresses Service Bus scaler
  managed-identity auth as `rules[].custom.identity` (UAMI resource ID) + `namespace`/`queueName`
  metadata (Entra, no connection string). If the toolchain rejects that shape, move `identity` to the
  rule level (`rules[].identity`). Assumption flagged inline in the module — owner validates on first build.
- **Entra-DB principal wiring.** Postgres has `activeDirectoryAuth: Enabled`, but mapping the workload
  identity as an AAD DB role (for password-less app→DB) is left as the hardening follow-on above; the
  wired default is the KV `db-connection-string` (password) reference.

---

## 14. Files in this design

- `specs/infra/azure-environments.md` — this document.
- `infra/bicep/main.bicep` — orchestrator (identity, Log Analytics, ACR, KV-secret seeding, module wiring).
- `infra/bicep/modules/containerApps.bicep` — env + api/workers/chaos-proxy/plugin/omnipizza, scale-to-zero/KEDA.
- `infra/bicep/modules/postgres.bicep` — Flexible Server B1ms + pgvector allowlist.
- `infra/bicep/modules/blob.bicep` — private artifacts/knowledge containers + lifecycle + SAS role.
- `infra/bicep/modules/serviceBus.bicep` — `runs` queue + `run-events` topic, Entra-only.
- `infra/bicep/modules/keyVault.bicep` — RBAC vault + Secrets User role for the workload identity.

> **DESIGN ONLY.** No `az`/`bicep` is run, nothing is deployed, no network is hit, no cost is incurred by
> authoring or reading these files.
