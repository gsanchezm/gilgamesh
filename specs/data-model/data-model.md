# Gilgamesh — Data Model (entity dictionary & contract)

> Companion to `schema.prisma` (same directory). Both are **design/spec artifacts** —
> declarative contracts, never applied (no migrations run here).
> Single source of truth for names/enums: `specs/_keystone/foundation-vocabulary.md`
> (§1 enums, §2 entities, §3 roster, §5 ports, §8 integration keys). This document
> adheres to the Keystone **verbatim**: identical entity names, field names, enum values,
> uniques, and the mandated per-`orgId` indexes. Deviations are listed in the last section.

---

## 1. Conventions (from Keystone §0)

- **IDs**: UUID v7 string, stored as native postgres `uuid` (`@db.Uuid`). Time-ordered →
  index-friendly, good B-tree locality for newest-first scans. App-assigned (or Prisma
  `@default(uuid(7))`); never sequential integers (no cross-tenant enumeration).
- **Tables/columns**: snake_case (`@@map` / `@map`); Prisma models PascalCase; API JSON camelCase.
- **Timestamps**: `createdAt`/`updatedAt` (UTC) **only where the Keystone §2 lists them**.
  Six entities are intentionally timestamp-less (Slice, Scenario, RunNode, KnowledgeChunk,
  Subscription, Integration) — see §8.
- **Soft-delete**: the Keystone designates **no** `deletedAt` on any entity in v0.1 → all deletes
  are **hard deletes with cascade** (§8). `Session.revokedAt` and `User.status=DISABLED` are
  explicit logical states, not row soft-deletes.
- **Tenant scope**: every tenant-scoped row carries a non-null `orgId` FK, indexed, and filtered in
  **every** query (§2). Tenant roots (`Org`, `User`, `Session`) are not org-scoped.
- **Money/percentages**: `ratePct` is `Float` (display stat). Counts (`passed/failed/skipped/total/
  progress/seats/level/ordinal/order`) are `Int`. `sizeBytes` is `BigInt` (videos exceed 2³¹).
- **Secrets**: `Integration.secretRef` is a **Key Vault reference only** — raw tokens are never
  stored. `User.passwordHash` is Argon2id. `Artifact.storageKey` is resolved to a **signed expiring
  URL** at read time (blobs never public).

---

## 2. Tenant-isolation strategy (row-level by `orgId`)

Multi-tenant SaaS for many companies; **isolation is primordial** (target OWASP ASVS L2). Defense in
depth, three layers, plus a documented residual gap and its hardening.

### 2.1 `orgId` is intentionally denormalized
Every tenant-scoped table carries `org_id` **even when it is derivable through a parent** (e.g. a
`Feature` already reaches its Org via `project`). The duplication is deliberate: it makes both the
application tenant filter and the RLS policy a **single-column predicate with no joins**, so every
tenant-scoped query is index-backed on `org_id` and uniformly enforceable.

### 2.2 Layer 1 — application (primary)
- The authenticated request resolves `session → user → membership → orgId` (Keystone §6: "every
  request resolves tenant from session→orgId").
- A **Prisma Client extension** (`$extends` query middleware) injects `where: { orgId }` into every
  `find*/update*/delete*/count/aggregate` and sets `orgId` on every `create`. The repository layer
  refuses any tenant-scoped query lacking a resolved `orgId`. This is the day-to-day guard.
- **Same-org validation is MANDATORY on EVERY cross-row reference write** (not a curated subset) until
  composite FKs land (§2.5). Every FK that points at another tenant-scoped row is validated to resolve to
  the **same** `orgId` before persistence — this is the application-layer guard against broken
  object-level authorization (a mis-tenanted child row). The set explicitly includes, at minimum:
  `Run.createdById`, `TestCase.assignedAgentId`, `RunNode.agentId`, **`*.sliceId`** (Feature/TestCase/
  RunNode), **`KnowledgeChunk.docId`**, **`generateTestCases` `docId`/`sliceId`**, and **all create-time
  parent references** (`projectId`, `runId`, `featureId`, `agentId`, `connectedById`, …). A CI test
  asserts `child.orgId == parent.orgId` for every such reference (§7).

### 2.3 Layer 2 — Postgres Row-Level Security (defense-in-depth)
- Each tenant-scoped table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy
  `USING (org_id = current_setting('app.current_org_id')::uuid)` with the same `WITH CHECK`.
- Per request/transaction the app issues `SET LOCAL app.current_org_id = '<orgId>'`.
- Prisma connects as a **non-superuser, non-`BYPASSRLS`** application role so policies actually apply
  (table-owner/superuser roles bypass RLS — must not be the app role). This catches any code path that
  ever forgets the Layer-1 filter.

### 2.4 Layer 3 — least-privilege at the edges
- Artifacts/knowledge blobs are never public: served only via short-TTL signed URLs (`ArtifactStorage.
  signedUrl`, Keystone §5).
- RBAC (`Membership.role`) gates actions; `AuditLog` records sensitive ones.

### 2.5 Residual gap & hardening (called out explicitly)
Because `org_id` is denormalized, a buggy write **could** in principle set `org_id = A` on a child whose
parent (`project_id`/`run_id`/…) belongs to org B. Layers 1–3 all key on `org_id`, so a poisoned row
would still be *consistently* mis-tenanted, not leaked across the policy — but it would be attributed to
the wrong tenant. The structural fix is **composite foreign keys**: add `@@unique([orgId, id])` on each
parent and point the child FK at `(orgId, parentId) → (orgId, id)`, so the database itself rejects a
parent/child org mismatch.

This is **the most security-relevant deferral in the model** — it is broken object-level authorization at
the data layer (a child row attributable to the wrong tenant). The structural fix: `@@unique([orgId, id])`
on each parent + a composite child FK `(orgId, parentId) → (orgId, id)`, so the DB itself rejects an
org mismatch.

**v0.1 decision:** keep single-column FKs (Prisma forbids reusing the `orgId` scalar across two
relations, so composite-FK tenancy requires dropping the direct `org` relation on children and
navigating org via the parent — a heavier remodel; a half-application — `@@unique([orgId,id])` on parents
without the child composite FKs — would be an incoherent state, so it is all-or-nothing). Until it lands
the gap is held by **(a)** MANDATORY Layer-1 same-org validation on *every* cross-row write (§2.2) — no
longer a curated subset — plus **(b)** Layer-2 RLS, **(c)** a CI test asserting `child.orgId ==
parent.orgId` (§7). Composite-FK enforcement is **reclassified from "open question" to GA-BLOCKING
hardening** (§10): it must land before GA, not "be revisited."

---

## 3. ASCII ERD

Cardinality: `1 ──< *` = one-to-many (crow's foot on the many side); `1 ──1` = one-to-one;
`?` on a relation = optional FK (nullable). Tenant roots shaded with `══`.

```
  ══════════                         ══════════
  ║  User  ║ (global)                ║  Org   ║  ROOT TENANT
  ══════════                         ══════════  (every box below carries org_id, FK→Org, indexed)
     │ │ │ │ │                            │
     │ │ │ │ └────────────< Session       ├──< Membership >────────┐ (Org 1──< Membership *>──1 User)
     │ │ │ │  (User 1──< *)               │                        │
     │ │ │ └──────< AuditLog.actor?       ├──1 Subscription        │
     │ │ └────< Integration.connectedBy?  │                        │
     │ └──< KnowledgeDoc.createdBy        ├──< Integration         │
     └──< Run.createdBy                   ├──< Agent ─────────┐    │
                                          │                   │    │
                                          ├──< KnowledgeDoc ──┼──< KnowledgeChunk
                                          │        (Doc 1──< Chunk *)   │
                                          ├──< AuditLog                 │
                                          │                             │
                                          └──< Project ────────────────┴───────────────┐
                                                  │                                     │
                ┌─────────────────────────────────┼──────────────────────┬─────────────┤
                │                                  │                      │             │
                ▼                                  ▼                      ▼             ▼
              Slice ──< Feature ──< Scenario     TestCase            ToolBinding       Run
                │  \        (Feat 1──< Scen *)   (assignedAgent?     (Project 1──1     │
                │   \                             →Agent, slice?)     Agent via         │
                │    └──< Feature.slice? (SetNull)                    unique pair)      ▼
                │                                                                     RunNode
                ├──< TestCase.slice? (SetNull)                       Agent ──< RunNode.agent?  │
                └──< RunNode.slice? (SetNull)                        Agent ──< ToolBinding     │
                                                                     Agent ──< TestCase.assigned▼
                                                                                          Artifact
                                                          (Run 1──< RunNode 1──< Artifact;
                                                           Artifact.runNode? SetNull; Run 1──< Artifact)
```

Reading aids:
- **Org** is the apex; deleting it cascades the whole subtree (§8).
- **User** is global and links in via `Membership`, `Session`, and four ownership FKs
  (`Run.createdBy`, `KnowledgeDoc.createdBy`, `Integration.connectedBy?`, `AuditLog.actor?`).
- **Agent** (per-Org catalog of 11) fans out to `ToolBinding` (per-Project), `RunNode.agent?`, and
  `TestCase.assignedAgent?`.
- Authoring chain: `Project → Slice → Feature → Scenario`; cases: `Project → TestCase`.
- Run chain: `Project → Run → RunNode → Artifact` (artifacts also attach directly to the Run).

---

## 4. Entity dictionary

Each entity below maps verbatim to Keystone §2. `PK` = primary key, `FK` = foreign key,
`U` = unique, `IX` = index. `?` marks nullable. Types abbreviated (full types in `schema.prisma`).

### 4.1 Org  — `orgs` (root tenant)
| field | type | notes |
|---|---|---|
| id | uuid | PK (UUID v7) |
| name | text | display |
| slug | text | **U** (global) |
| createdAt / updatedAt | timestamptz | |

Relationships: `Org 1 ──< *` every tenant-scoped entity; `Org 1 ──1 Subscription`.
Indexes: `U(slug)`. Cascade: deleting an Org hard-deletes its entire subtree.

### 4.2 User  — `users` (global identity)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| email | citext | **U**, case-insensitive (citext extension) |
| passwordHash | text | Argon2id |
| firstName | text | |
| middleName? | text | |
| lastName | text | |
| status | UserStatus | `ACTIVE`\|`DISABLED`, default `ACTIVE` (derived enum, §9) |
| createdAt / updatedAt | timestamptz | |

Relationships: `User 1 ──< *` Membership, Session; `1 ──< *` Run (createdBy), KnowledgeDoc (createdBy),
Integration (connectedBy?), AuditLog (actor?). A User belongs to many Orgs via Membership.
Indexes: `U(email)`. **Not** org-scoped. Hard-delete blocked while the user owns Runs/KnowledgeDocs
(`Restrict`); users are normally **disabled** (`status`), not deleted.

### 4.3 Membership  — `memberships` (RBAC join)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| userId | uuid | **FK→User** |
| role | Role | `OWNER`\|`ADMIN`\|`MEMBER`\|`VIEWER` |
| createdAt | timestamptz | |

Relationships: `Org 1 ──< Membership *>── 1 User`.
Indexes: **U(orgId, userId)** (left-prefix = the org_id index); `IX(userId)` reverse lookup.
Cascade from Org and from User.

### 4.4 Session  — `sessions` (local auth)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid | **FK→User** |
| tokenHash | text | **U** (opaque session token hash; never the raw token) |
| expiresAt | timestamptz | |
| ip? / userAgent? | text | |
| createdAt | timestamptz | |
| revokedAt? | timestamptz | logical revocation (not a row soft-delete) |

Relationships: `User 1 ──< Session *`. Indexes: `U(tokenHash)`, `IX(userId)`, `IX(expiresAt)` (sweep).
**Not** org-scoped (a session is global to the user; tenant is selected per request). Cascade from User.

### 4.5 Project  — `projects`
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| name | text | |
| slug | text | unique within org |
| format | ProjectFormat | `BDD`\|`TRADITIONAL` |
| repoProvider? | RepoProvider | `github`\|`gitlab`\|`bitbucket`\|`ado` (derived enum, §9) |
| repoFullName? / repoBranch? / repoCommit? | text | |
| repoLastSyncAt? | timestamptz | |
| createdAt / updatedAt | timestamptz | |

Relationships: `Org 1 ──< Project *`; `Project 1 ──< *` Slice, Feature, TestCase, ToolBinding, Run;
`Project 1 ──< KnowledgeDoc *` (optional side). Indexes: **U(orgId, slug)** (left-prefix = org_id index).
Cascade from Org; cascades to its children.

### 4.6 Slice  — `slices` (vertical slice)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId | uuid | **FK→Project** |
| key | text | e.g. Checkout/Login/Catalog/Payments/Imported |
| name | text | |
| order | int | display order |

Relationships: `Project 1 ──< Slice *`; `Slice 1 ──< *` Feature(slice?), TestCase(slice?), RunNode(slice?).
Indexes: **U(projectId, key)**, **IX(orgId)**. No timestamps (Keystone §2). Cascade from Project/Org;
nulls out optional children's `sliceId` on delete (`SetNull`).

### 4.7 Feature  — `features` (BDD `.feature`)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId | uuid | **FK→Project** |
| sliceId? | uuid | **FK→Slice** (SetNull) |
| name / path | text | |
| content | text | gherkin source |
| createdAt / updatedAt | timestamptz | |

Relationships: `Project 1 ──< Feature *`; `Slice 0..1 ──< Feature *`; `Feature 1 ──< Scenario *`.
Indexes: **IX(orgId)**, **IX(projectId)**, **IX(sliceId)**. Cascade from Project/Org; cascades to Scenario.

### 4.8 Scenario  — `scenarios`
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| featureId | uuid | **FK→Feature** |
| name | text | |
| order | int | |
| lastStatus? | TestCaseStatus | last execution result |

Relationships: `Feature 1 ──< Scenario *`. Indexes: **IX(orgId)**, **IX(featureId)**. No timestamps
(Keystone §2). Cascade from Feature/Org.

### 4.9 TestCase  — `test_cases` (traditional)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId | uuid | **FK→Project** |
| sliceId? | uuid | **FK→Slice** (SetNull) |
| key | text | e.g. `TC_CHK_001` |
| title | text | |
| steps / data / expected | text | |
| priority | TestCasePriority | `HIGH`\|`MEDIUM`\|`LOW` |
| status | TestCaseStatus | default `NOTRUN` |
| assignedAgentId? | uuid | **FK→Agent** (SetNull) |
| createdAt / updatedAt | timestamptz | |

Relationships: `Project 1 ──< TestCase *`; `Slice 0..1 ──< TestCase *`; `Agent 0..1 ──< TestCase *`.
Indexes: **U(projectId, key)** *(extension, §9; left-prefix = projectId index)*, **IX(orgId)**,
**IX(sliceId)**, **IX(assignedAgentId)**, **IX(projectId, status)**, **IX(projectId, priority)** *(PERF:
index-backed status/priority list filters — §6.3)*. Cascade from Project/Org; SetNull on slice/agent delete.

### 4.10 Agent  — `agents` (per-Org catalog of 11)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| slot | AgentSlot | `lead`\|`arch`\|…\|`a11y` (stable lowercase key) |
| deityName | text | e.g. Zeus, Athena (roster §3) |
| role | text | **display label** (e.g. "QA Lead") — NOT the RBAC `Role` enum |
| family | AgentFamily | `proceso`\|`ui`\|`backend`\|`guardian` |
| glyph / culture / defaultTool | text | |
| createdAt | timestamptz | |

Relationships: `Org 1 ──< Agent *` (exactly 11, seeded from §3); `Agent 1 ──< *` ToolBinding,
RunNode(agent?), TestCase(assignedAgent?). Indexes: **U(orgId, slot)** (left-prefix = org_id index).
**Runtime status** (`AgentRuntimeStatus`) is **derived, not stored**: `IDLE` if no enabled ToolBinding;
`BUSY` if the agent has a RunNode in `RUNNING`; else `ACTIVE`. Cascade from Org.

### 4.11 ToolBinding  — `tool_bindings` (per-Project agent state + tool, Strategy)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId | uuid | **FK→Project** |
| agentId | uuid | **FK→Agent** |
| tool | text | selected tool ∈ per-role options (§3) |
| enabled | bool | "awake" flag, default `false` |
| updatedAt | timestamptz | (only timestamp per §2) |

Relationships: `Project 1 ──< ToolBinding *`; `Agent 1 ──< ToolBinding *`; one binding per
(project, agent). Indexes: **U(projectId, agentId)**, **IX(orgId)**, **IX(agentId)**.
Cascade from Project/Agent/Org.

### 4.12 Run  — `runs`
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId | uuid | **FK→Project** |
| status | RunStatus | default `QUEUED` |
| mode | RunMode | `BDD`\|`STEPS` |
| trigger | RunTrigger | `MANUAL`\|`CI`\|`SCHEDULE` |
| selectedStages | text[] | stage keys chosen |
| progress | int | 0..100 (app-enforced), default 0 |
| runLabel | text | e.g. `local · main · 2026-05-25 19:00:02` |
| commitSha? | text | |
| passed? / failed? / skipped? / total? | int | rollup |
| ratePct? | float | pass rate % |
| durationMs? | int | |
| createdById | uuid | **FK→User** (Restrict) |
| startedAt? / finishedAt? / createdAt | timestamptz | (no `updatedAt`) |

Relationships: `Project 1 ──< Run *`; `User 1 ──< Run *` (createdBy); `Run 1 ──< RunNode *`;
`Run 1 ──< Artifact *`. Indexes: **`IX(projectId, createdAt DESC)` — HOT PATH** (runs list display,
newest-first), **`IX(projectId, id DESC)`** *(PERF: keyset cursor; UUID v7 = time-ordered, unambiguous
tiebreaker — §6.3)*, **IX(projectId, status)**, **IX(orgId)**, **IX(createdById)**.
Cascade from Project/Org; `Restrict` on creator delete (preserves attribution).

### 4.13 RunNode  — `run_nodes` (DAG node)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| runId | uuid | **FK→Run** |
| key | text | node id; referenced by `deps`/waves/RunEvent.nodeKey (§5) |
| kind | RunNodeKind | `DISPATCH`\|`STAGE`\|`CONSOLIDATE` |
| agentId? | uuid | **FK→Agent** (SetNull) — null on dispatch/consolidate |
| tool? / feature? | text | |
| sliceId? | uuid | **FK→Slice** (SetNull) |
| level | int | wave/level (0 = dispatch) |
| deps | text[] | other RunNode.key values in the same run |
| state | RunNodeState | default `IDLE` |
| passed? / failed? / skipped? | int | |
| durationMs? | int | |
| startedAt? / finishedAt? | timestamptz | (no createdAt per §2) |

Relationships: `Run 1 ──< RunNode *`; `Agent 0..1 ──< RunNode *`; `Slice 0..1 ──< RunNode *`;
`RunNode 1 ──< Artifact *`. Indexes: **U(runId, key)** *(§5 contract: key resolves uniquely within a
run; left-prefix = runId index)*, **`IX(runId, level)` — HOT PATH** (fetch the DAG by run, ordered by
wave), **IX(orgId)**, **IX(agentId)**, **IX(sliceId)**, **IX(orgId, state, agentId)** *(PERF: set-based
BUSY-status derivation; + a raw-SQL partial index `WHERE state='RUNNING'` — §6.3)*. Cascade from Run/Org.

### 4.14 Artifact  — `artifacts` (run blob)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| runId | uuid | **FK→Run** |
| runNodeId? | uuid | **FK→RunNode** (SetNull) |
| type | ArtifactType | `VIDEO`\|`SCREENSHOT`\|`HAR`\|`LOG`\|`REPORT_HTML` |
| storageKey | text | blob key → signed expiring URL at read (never public) |
| contentType | text | |
| sizeBytes | bigint | videos exceed 2³¹ |
| capturedAt | timestamptz | |
| meta | json | non-sensitive metadata |

Relationships: `Run 1 ──< Artifact *`; `RunNode 0..1 ──< Artifact *`. Indexes: **IX(orgId)**,
**IX(runId)**, **IX(runNodeId)**. Cascade from Run/Org; SetNull if its RunNode is removed.

### 4.15 Integration  — `integrations`
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| key | text | stable key (§8): `github`,`jira`,`slack`,… |
| group | IntegrationGroup | 6 groups |
| connected | bool | default `false` |
| secretRef? | text | **Key Vault reference only — never a raw token** |
| config | json | non-secret settings |
| connectedById? | uuid | **FK→User** (SetNull) |
| connectedAt? | timestamptz | (no createdAt/updatedAt per §2) |

Relationships: `Org 1 ──< Integration *` (one row per key); `User 0..1 ──< Integration *` (connectedBy).
Indexes: **U(orgId, key)** (left-prefix = org_id index). Cascade from Org; SetNull on connector delete.

### 4.16 Subscription  — `subscriptions` (1:1 Org)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **U FK→Org** (one per org) |
| plan | Plan | `FREE`\|`STARTER`\|`GROWTH`\|`SCALE` |
| billingCycle | BillingCycle | `MONTHLY`\|`ANNUAL` |
| seats | int | Active workspaces (legacy column name). |
| status | SubscriptionStatus | `TRIALING`\|`ACTIVE`\|`PAST_DUE`\|`CANCELED` |
| runMinutesQuota | int | Monthly execution quota (legacy column name). |
| runMinutesUsed | int | Monthly executions used (legacy column name); default 0 (per-org metering). |
| providerCustomerId? / providerSubscriptionId? | text | mock provider now |
| currentPeriodEnd? | timestamptz | (no createdAt/updatedAt per §2) |

Relationships: `Org 1 ──1 Subscription`. Indexes: **U(orgId)** (also the org_id index). Cascade from Org.

### 4.17 KnowledgeDoc  — `knowledge_docs` (private RAG source)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| projectId? | uuid | **FK→Project** (SetNull) — null ⇒ org-wide |
| name | text | |
| sizeBytes | bigint | |
| storageKey | text | blob key (signed URL at read) |
| status | KnowledgeDocStatus | `UPLOADED`\|`INDEXING`\|`INDEXED`\|`FAILED` |
| createdById | uuid | **FK→User** (Restrict) |
| createdAt | timestamptz | |

Relationships: `Org 1 ──< KnowledgeDoc *`; `Project 0..1 ──< KnowledgeDoc *`; `KnowledgeDoc 1 ──<
KnowledgeChunk *`. Indexes: **IX(orgId)**, **IX(projectId)**, **IX(createdById)**.
Cascade from Org; SetNull if its Project is deleted; cascades to chunks.

### 4.18 KnowledgeChunk  — `knowledge_chunks` (pgvector)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| docId | uuid | **FK→KnowledgeDoc** |
| ordinal | int | chunk order within doc |
| content | text | chunk text |
| embedding | vector(1536) | pgvector; `Unsupported` in Prisma (insert via `$executeRaw`) |

Relationships: `KnowledgeDoc 1 ──< KnowledgeChunk *`. Indexes: **IX(orgId)**, **IX(docId)**, and the
**HNSW ANN index on `embedding`** (raw SQL — §6.3). No timestamps (Keystone §2). Cascade from Doc/Org.
**Tenant-scoped retrieval**: `WHERE org_id = $1 ORDER BY embedding <=> $query LIMIT k`. The `org_id`
predicate MUST **pre-filter** the ANN scan (per-partition HNSW, or `hnsw.iterative_scan`) — a global
HNSW post-filters and loses recall at any multi-tenant ratio (GA-blocking — §6.3 item 4, §10).

### 4.19 AuditLog  — `audit_logs` (append-only)
| field | type | notes |
|---|---|---|
| id | uuid | PK |
| orgId | uuid | **FK→Org** |
| actorUserId? | uuid | **FK→User** (SetNull) — null ⇒ system action |
| action | text | e.g. `integration.connect`, `member.role.change` |
| targetType | text | entity name |
| targetId? | text | free-form id (polymorphic) |
| metadata | json | structured detail |
| ip? | text | |
| createdAt | timestamptz | |

Relationships: `Org 1 ──< AuditLog *`; `User 0..1 ──< AuditLog *` (actor). Indexes:
**`IX(orgId, createdAt DESC)`** (org audit browse; also the org_id index), **IX(orgId, targetType,
targetId)** (per-entity history), **IX(actorUserId)**. Append-only; SetNull on actor delete; cascades on
org purge (export-before-delete recommended for retention/compliance — §8).

---

## 5. Relationships summary (cardinality)

| Parent | → | Child | Card. | Child FK | onDelete |
|---|---|---|---|---|---|
| Org | → | Membership | 1 ──< * | orgId | Cascade |
| Org | → | Project / Slice / Feature / Scenario / TestCase / Agent / ToolBinding / Run / RunNode / Artifact / Integration / KnowledgeDoc / KnowledgeChunk / AuditLog | 1 ──< * | orgId | Cascade |
| Org | → | Subscription | 1 ──1 | orgId (U) | Cascade |
| User | → | Membership | 1 ──< * | userId | Cascade |
| User | → | Session | 1 ──< * | userId | Cascade |
| User | → | Run | 1 ──< * | createdById | **Restrict** |
| User | → | KnowledgeDoc | 1 ──< * | createdById | **Restrict** |
| User | → | Integration | 1 ──< * | connectedById? | SetNull |
| User | → | AuditLog | 1 ──< * | actorUserId? | SetNull |
| Project | → | Slice / Feature / TestCase / ToolBinding / Run | 1 ──< * | projectId | Cascade |
| Project | → | KnowledgeDoc | 1 ──< * | projectId? | SetNull |
| Slice | → | Feature / TestCase / RunNode | 1 ──< * | sliceId? | SetNull |
| Feature | → | Scenario | 1 ──< * | featureId | Cascade |
| Agent | → | ToolBinding | 1 ──< * | agentId | Cascade |
| Agent | → | RunNode | 1 ──< * | agentId? | SetNull |
| Agent | → | TestCase | 1 ──< * | assignedAgentId? | SetNull |
| Run | → | RunNode | 1 ──< * | runId | Cascade |
| Run | → | Artifact | 1 ──< * | runId | Cascade |
| RunNode | → | Artifact | 1 ──< * | runNodeId? | SetNull |
| KnowledgeDoc | → | KnowledgeChunk | 1 ──< * | docId | Cascade |

`Membership` realizes the many-to-many `User ⟷ Org` (with `Role`).
`ToolBinding` realizes the many-to-many `Project ⟷ Agent` (with tool + enabled).

---

## 6. Index & performance plan

### 6.1 Every `orgId` index (mandate satisfied)
Per Keystone §2, every tenant-scoped row's `org_id` is indexed. Where a composite **unique** already
leads with `org_id`, that left-prefix **is** the org_id index (no redundant standalone index added):

| Covered by composite-unique left-prefix | Explicit `IX(orgId)` |
|---|---|
| Membership `U(orgId,userId)`, Project `U(orgId,slug)`, Agent `U(orgId,slot)`, Integration `U(orgId,key)`, Subscription `U(orgId)`, AuditLog `IX(orgId,createdAt)` | Slice, Feature, Scenario, TestCase, ToolBinding, Run, RunNode, Artifact, KnowledgeDoc, KnowledgeChunk |

(`Org`, `User`, `Session` are tenant roots → no `org_id`.)

### 6.2 Uniques (from Keystone §2 + flagged extensions)
- Keystone: `Org.slug`, `User.email`, `Membership(orgId,userId)`, `Project(orgId,slug)`,
  `Slice(projectId,key)`, `Agent(orgId,slot)`, `ToolBinding(projectId,agentId)`,
  `Integration(orgId,key)`, `Subscription.orgId`. Plus `Session.tokenHash` (auth lookup).
- Extension / contract-derived: `TestCase(projectId,key)` (prototype treats `TC_*` as an ID — **§9
  extension**), `RunNode(runId,key)` (**required by the §5 kernel contract** — `deps`/`waves`/`nodeKey`
  resolve a node by `key` within a run).

### 6.3 Hot-path indexes (called out per task)
1. **Runs by project** — `runs (project_id, created_at DESC)` for newest-first display ordering, **plus
   `runs (project_id, id DESC)` as the keyset-pagination cursor**: `created_at` is not unique, so a
   `(created_at, id)` cursor can skip/duplicate rows sharing a timestamp on deep pages; `id` is UUID v7
   (time-ordered), so `(project_id, id DESC)` is newest-first *and* an unambiguous tiebreaker.
2. **Run nodes by run** — `run_nodes (run_id, level)`. Loads the whole DAG for one run ordered by wave;
   plus `U(run_nodes(run_id, key))` for key lookups during execution/event application. **BUSY
   derivation** (`AgentRuntimeStatus=BUSY` ⇔ agent has a RunNode in `RUNNING`) is supported by
   `run_nodes (org_id, state, agent_id)` (Prisma) + a tighter partial `run_nodes (agent_id) WHERE
   state='RUNNING'` (raw SQL) so the Agent room derives it as **one set-based query**, not 11 per-agent
   existence checks. (`run_nodes` carries no `project_id` — keystone §2 — so project scoping joins
   `runs`; we do **not** denormalize `project_id` onto the node, to stay verbatim to the keystone.)
3. **Test cases list filters** — `test_cases (project_id, status)` and `test_cases (project_id, priority)`
   back the advertised `≤200 ms` filtered list (`GET /projects/{id}/test-cases?status=&priority=`); without
   them, status/priority filtering degrades to a project-wide scan.
4. **Knowledge chunks vector index** — HNSW ANN on `knowledge_chunks.embedding`
   (`vector_cosine_ops`, `m=16, ef_construction=64`), created via **raw SQL** (Prisma cannot express
   operator-class/ANN indexes). **RECALL-CORRECTNESS (GA-blocking, not just scale):** a *single global*
   HNSW **post-filters** `org_id` — it returns ~`ef_search` nearest neighbors then drops foreign-org rows,
   so for any tenant that is a minority of the table most candidates are discarded → **fewer than `k`
   results and collapsing recall at any multi-tenant ratio**. The `org_id` predicate MUST be
   **pre-filtering**:
   - **Primary:** `PARTITION BY` (hash/list) `org_id` with a **per-partition HNSW** so each scan is
     already tenant-local (works on any pgvector version).
   - **Quick win (pgvector 0.8+):** `SET hnsw.iterative_scan = relaxed_order` + raise `hnsw.ef_search`
     per query so the scan continues until `k` tenant-local rows are found.

   Retrieval stays tenant-scoped first (`WHERE org_id = $1`) then ANN-ranked
   (`ORDER BY embedding <=> $query LIMIT k`). CI adds a **recall@k assertion** + the vector p95 to the
   perf gate (§6.4). Raw DDL + query settings are in the `schema.prisma` companion. (See §10 — this is
   reclassified from "scale follow-up" to GA-blocking recall fix.)

### 6.4 Performance budgets (data layer; enforced in CI perf gates)
Performance is first-class. Targets are **server-side DB time**, steady state:

| Operation | Budget (p95) |
|---|---|
| Fetch by PK (uuid) | < 10 ms |
| Index-backed tenant list (runs-by-project, cases-by-project, members) | < 50 ms |
| Full DAG fetch (run_nodes by run) | < 30 ms |
| Vector top-k retrieval (k=8, HNSW) | < 150 ms |
| Single-row insert/update | < 20 ms |
| Audit append | < 15 ms |

Guards: keep tenant predicates index-backed (no seq scans on tenant tables in `EXPLAIN`); cursor
pagination (no `OFFSET` on hot lists); UUID v7 PKs preserve newest-first locality. **Vector retrieval is
gated by BOTH a `<150 ms` p95 AND a `recall@k` floor** (latency alone hides the post-filter recall loss of
§6.3 item 4); the vector p95 is added to the CI perf gate. API/runtime budgets (latency, runner
concurrency, streamed UI) live in the performance-budgets artifact.

---

## 7. Tenant-isolation enforcement checklist (recap)
- [ ] Non-null `org_id` FK + index on all 16 tenant-scoped tables (roots excepted).
- [ ] Prisma `$extends` injects `orgId` filter on read/write; create stamps `orgId`.
- [ ] **MANDATORY** same-org validation on **every** cross-reference write — `createdById`,
      `assignedAgentId`, `agentId`, **`sliceId`** (Feature/TestCase/RunNode), **`docId`**
      (KnowledgeChunk + `generateTestCases`), and **all create-time parent refs** — not a curated subset.
- [ ] **CI test asserts `child.orgId == parent.orgId`** for every cross-row reference (the structural
      guard until composite FKs land — §2.5, GA-blocking).
- [ ] RLS `ENABLE`+`FORCE` + `current_setting('app.current_org_id')` policy on every tenant table.
- [ ] Prisma uses a non-superuser, non-`BYPASSRLS` role; `SET LOCAL app.current_org_id` per txn.
- [ ] Blobs only via signed expiring URLs; secrets only as Key Vault refs.
- [ ] `audit_logs` is INSERT+SELECT only for the app role (UPDATE/DELETE/TRUNCATE revoked); Log Analytics
      is the immutable retained copy; Org-purge exports+retains audit rows first (§8).

---

## 8. Cascade & soft-delete notes
- **No soft-delete in v0.1.** The Keystone designates no `deletedAt` field on any entity → hard deletes.
  If soft-delete is needed later it must be added to the Keystone **first** (then `deletedAt?` + filtered
  queries). `Session.revokedAt` / `User.status=DISABLED` are explicit states, not row soft-deletes.
- **Org delete = full tenant purge** (Cascade through the whole subtree). This is a guarded admin
  operation; **export-and-retain audit logs + run/report records before purge is a HARD, mandatory step**
  of the purge operation (not a recommendation) — `audit_logs` (and runs/artifacts) cascade on Org delete
  and would otherwise be destroyed. The export target is the immutable Log Analytics sink (infra §3).
- **Audit log is append-only / tamper-evident** (ASVS V7): the application DB role is granted
  `INSERT`+`SELECT` on `audit_logs` only; `UPDATE`/`DELETE`/`TRUNCATE` are **REVOKEd** (raw-SQL companion
  in `schema.prisma`). Nothing in the app path can rewrite or erase an audit row; the retained immutable
  copy lives in Log Analytics.
- **Restrict on ownership**: `Run.createdById` and `KnowledgeDoc.createdById` are non-null → `Restrict`
  prevents deleting a User who owns runs/docs (attribution integrity). Users are disabled, not deleted.
- **SetNull on optional refs**: `Feature/TestCase/RunNode.sliceId`, `TestCase.assignedAgentId`,
  `RunNode.agentId`, `Artifact.runNodeId`, `KnowledgeDoc.projectId`, `Integration.connectedById`,
  `AuditLog.actorUserId` — the child survives, the link clears.
- **Timestamp-less entities** (faithful to Keystone §2, not an omission to fix here): Slice, Scenario,
  RunNode, KnowledgeChunk, Subscription, Integration.

---

## 9. Derived enums & deviations

**Enums derived from §2 inline field specs (not in the §1 list — transcribed, not invented):**
- `UserStatus { ACTIVE, DISABLED }` — from `User.status(ACTIVE|DISABLED)`.
- `RepoProvider { github, gitlab, bitbucket, ado }` — from `Project.repoProvider?(github|gitlab|
  bitbucket|ado)`. Lowercase stable keys (§0). Modeled as an enum (closed set of 4) — contrast
  `Integration.key`, kept a **String** because §8 is an open 17-key registry that may grow without a
  schema change.

**§1 enums defined but not attached to a stored column** (mapped per task; usage is computed/DTO-only):
- `AgentRuntimeStatus` — **derived** (Keystone §1): `IDLE` if no enabled ToolBinding; `BUSY` if a RunNode
  is `RUNNING`; else `ACTIVE`. No `Agent.runtimeStatus` column (would be drift).
- `CaptureMode` — capture settings are not a §2 entity field in v0.1; enum exists for DTOs/use-cases.
- `BrainTier` — used by `AgentBrainPort` (§5), not persisted.

**Deviations / extensions (explicitly flagged):**
1. **`TestCase(projectId, key)` unique** — added integrity constraint (not in §2). Justification: the
   prototype treats `TC_CHK_001` as a per-project identifier; collisions would break case addressing.
2. **`RunNode(runId, key)` unique** — added, but **contract-backed** by Keystone §5 (`deps: string[]`,
   `waves: string[][]`, `RunEvent.nodeKey` all resolve a node by `key` within a run). Framed as an
   invariant the kernel contract already assumes, not a new design choice.
3. **`Session.tokenHash` unique** + `IX(expiresAt)`, and `IX` on reverse-lookup FKs
   (`Membership.userId`, `ToolBinding.agentId`, `Run.createdById`, etc.) — operational indexes beyond the
   §2 minimum; no new names/fields introduced.
4. **`@default(uuid(7))`** assumes Prisma 6.1+ app-side UUID v7. If unavailable, drop the default and
   assign UUID v7 in the app — identical contract (never applied here).

No entity names, field names, enum values, agent slots, port signatures, or OpenAPI/schema names were
changed or added relative to the Keystone.

---

## 10. GA-blocking hardening (was "open questions")
- **Composite-FK tenancy (GA-BLOCKING)** (§2.5): adopt `@@unique([orgId,id])` parents + `(orgId,parentId)`
  child FKs so an org-mismatch is structurally rejected by the DB. Reclassified from "open question" to
  **must-land-before-GA** — it is the structural close of broken object-level authorization. Until then,
  MANDATORY Layer-1 same-org validation on every cross-row write (§2.2) + the `child.orgId==parent.orgId`
  CI test (§7) hold the line. (Heavier Prisma remodel; all-or-nothing.)
- **KnowledgeChunk vector recall (GA-BLOCKING)**: partition-by-`org_id` with per-partition HNSW (or
  `hnsw.iterative_scan`+`ef_search` on pgvector 0.8+) so the tenant predicate **pre-filters** the ANN
  scan. Reclassified from "scale follow-up" to a **recall-correctness fix required before GA** (§6.3 item
  4) — the single global index loses recall at any multi-tenant ratio, not just at large scale. CI adds a
  `recall@k` assertion + the vector p95. Confirm embedding dim stays 1536 (model-dependent — Keystone §1
  `BrainTier`/owner LLM choice).
- **Audit retention (RESOLVED — see §8)**: export-and-retain-before-purge is now a HARD step of the Org
  purge (not optional), and `audit_logs` is INSERT/SELECT-only with the Log Analytics sink as the
  immutable retained copy. Remaining owner input: the retention *window* per compliance regime.
