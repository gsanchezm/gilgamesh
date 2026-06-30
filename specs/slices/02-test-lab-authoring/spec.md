# Slice 2 — Test Lab Authoring (SDD Spec)

> Spec-Driven-Design spec for the second vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-06-30. Status: DRAFT (owner-scoped: Núcleo CRUD + gherkin parsing + AI generate behind a stub brain).

---

## 1. Feature intent

Give an onboarded workspace a **Test Lab** where the team authors its tests — *before any execution* (runs
belong to the Orchestration slice). Concretely, within a `Project`:

1. **Organize** work into vertical **`Slice`s** (Checkout / Login / Catalog / …) — the planning containers
   that later group features, cases and run stages.
2. **Author BDD** — create/edit **`Feature`s** (Gherkin `.feature` text); the system **parses** the content
   into **`Scenario`** rows (name + order) so the lab always reflects what the `.feature` actually contains.
3. **Author Traditional** — create/edit **`TestCase`s** (title, steps, data, expected, priority) for projects
   that work in `TRADITIONAL` format, each optionally assigned to one of the org's 11 agents.
4. **AI-assist** — **generate** draft features/cases from a natural-language prompt via the
   `AgentBrainPort`; in this slice the port is wired to a **deterministic stub** adapter (real Claude lands in
   the Brain slice), so generation is offline, reproducible, and testable.

This slice **runs no tests** (keystone §7: "Test Lab authoring proceeds NOW behind the `TestKernel` port"),
so it has zero dependency on the `chaos-proxy` kernel, plugins, or a System-Under-Test.

---

## 2. Scope

### In scope
- **`Slice` authoring** — create, list (ordered), rename, reorder, delete; `key` unique per project.
- **`Feature` authoring (BDD)** — create, list (optionally by slice), read (with parsed scenarios), update
  (content re-parses scenarios), delete; assign to a `Slice`.
- **Gherkin parsing** — a pure domain service parses `Feature.content` into the `Feature` name + ordered
  `Scenario` rows (incl. `Scenario Outline`); invalid gherkin is rejected.
- **`TestCase` authoring (Traditional)** — create, list (optionally by slice), read, update, delete; optional
  `assignedAgentId` (must be in the org catalog); auto-`key` per project.
- **AI generate** — `POST /projects/{id}/test-cases/generate`: a prompt → draft `Feature`/`TestCase`
  suggestions returned for review (not auto-persisted), produced through `AgentBrainPort` (stub adapter now).
- Cross-cutting: per-`orgId` tenant isolation, RBAC, audit on sensitive actions, perf budgets, validation,
  RFC9457 errors, CSRF on mutations, the same two persistence wirings (in-memory + Prisma) as slice 1.

### Out of scope (explicitly deferred)
- **Test execution / runs / DAG / reports** — Orchestration & Reports slices (BLOCKED-UNTIL-DELIVERED).
- **Bulk `import`** (`/projects/{id}/test-cases/import`) — deferred (owner decision S2: "núcleo, sin import").
- **Real LLM provider** — `AgentBrainPort` is wired to a **stub** only; the Claude adapter (tiering, prompt
  caching, BYOK, token metering) is its own later slice (owner decision S2). No network/API key in slice 2.
- **RAG / Knowledge grounding of generation** — the stub does not retrieve; pgvector grounding is the
  Knowledge slice. `generate` takes only the prompt + lightweight project context.
- **Persisting generated drafts automatically** — `generate` returns suggestions; an explicit create persists
  them (reuses the CRUD endpoints). No "accept-all" bulk write in this slice.
- **Cross-project / cross-slice moves**, `Feature.path` filesystem sync, and repo round-tripping — later.
- **Run status on `Scenario.lastStatus` / `TestCase.status` beyond the seed default** — set to `NOTRUN`/null
  at authoring; only the Orchestration/Reports slices mutate them from real runs.

---

## 3. Actors / personas

| Actor | Description | Slice-2 capabilities |
|-------|-------------|----------------------|
| **Owner / Admin** (`OWNER`/`ADMIN`) | Tenant leads. | Full authoring: slices, features, cases, generate. |
| **Member** (`MEMBER`) | Standard member. | Full authoring (create/update/delete slices, features, cases, generate). |
| **Viewer** (`VIEWER`) | Read-only member. | Read slices/features/cases/scenarios; any mutation or generate → `403`. |
| **Anonymous** | Not authenticated. | No access (`401`). |

> Authoring is a `MEMBER`+ capability (consistent with slice-1 agent mutations). `VIEWER` is read-only.

---

## 4. User stories

- **US-1** As a member, I create vertical **slices** to organize my project's testing, so features and cases
  have a home.
- **US-2** As a member, I author a **`.feature`** in Gherkin and immediately see its **scenarios** parsed out,
  so the lab mirrors my source of truth.
- **US-3** As a member, I edit a feature's content and the scenario list updates (added/removed/reordered),
  so parsing stays in sync.
- **US-4** As a member working in a Traditional project, I author **test cases** with steps/data/expected and
  a priority, and optionally assign an agent, so manual coverage is captured.
- **US-5** As a member, I ask the AI to **generate** draft features/cases from a description, review them, and
  keep what's useful — so I start from a draft, not a blank page.
- **US-6** As a member, I can list/read/update/delete any of my slices, features and cases.
- **US-7** As a tenant, none of my slices/features/cases/scenarios is ever visible to another tenant.
- **US-8** As a viewer, I can read everything in the lab but change nothing.

---

## 5. Data contracts touched

All fields/types are authoritative from keystone §2/§1; this slice **reads and writes** these aggregates.

| Entity | Slice-2 usage | Key fields exercised |
|--------|---------------|----------------------|
| **Slice** | full CRUD; the planning container. | `projectId`, `key`, `name`, `order`, Unique(`projectId`,`key`). |
| **Feature** | full CRUD (BDD); content parsed into scenarios. | `projectId`, `sliceId?`, `name`, `path`, `content`(gherkin), `updatedAt`. |
| **Scenario** | **derived** from `Feature.content` on create/update; read with the feature. | `featureId`, `name`, `order`, `lastStatus?`(NOTRUN/null at authoring). |
| **TestCase** | full CRUD (Traditional). | `projectId`, `sliceId?`, `key`, `title`, `steps`, `data`, `expected`, `priority:TestCasePriority`, `status:TestCaseStatus`(=NOTRUN seed), `assignedAgentId?`. |
| **Agent** | read-only — validate `assignedAgentId` ∈ org catalog. | `orgId`, `slot`, Unique(`orgId`,`slot`). |
| **Project** | read — authoring is scoped to a project; tenant resolved via it. | `orgId`, `format:ProjectFormat`. |
| **AuditLog** | written on every sensitive authoring action (§9). | `actorUserId?`, `action`, `targetType`, `targetId?`, `metadata`. |

**Derived (not stored):** `Scenario[]` from `Feature.content` (the gherkin parser). `Scenario.lastStatus` and
`TestCase.status` stay at their authoring defaults (`null` / `NOTRUN`) — only later run slices change them.

**Seed / defaults (deterministic):**
- `Slice.order` = max(order)+1 within the project (append) unless a position is given.
- New `TestCase.status = NOTRUN`; `TestCase.key` auto = `TC_<SLICEKEY-or-PRJ>_<NNN>` (zero-padded, unique per project).
- New `Scenario.lastStatus = null` (no run yet).

---

## 6. API operations used (keystone §6)

Base path `/api/v1`. Auth via httpOnly session cookie + CSRF on unsafe methods. Errors are `Problem+json`.
Tenant resolved from session → active `Membership.orgId`; every list/detail filters by `orgId`; a resource in
another tenant returns `404` (no existence leak).

| # | Method + path | Purpose | Request DTO | Response DTO |
|---|---------------|---------|-------------|--------------|
| S1 | `POST /projects/{id}/slices` | Create a slice. | `SliceCreate` | `SliceView` |
| S2 | `GET /projects/{id}/slices` | List slices (ordered). | — | `SliceView[]` |
| S3 | `PATCH /slices/{id}` | Rename / reorder. | `SliceUpdate` | `SliceView` |
| S4 | `DELETE /slices/{id}` | Delete a slice (features/cases keep `sliceId=null`). | — | `204` |
| F1 | `POST /projects/{id}/features` | Create a feature; parse scenarios. | `FeatureCreate` | `FeatureView` |
| F2 | `GET /projects/{id}/features` | List features (optional `?sliceId=`). | — | `FeatureView[]` |
| F3 | `GET /features/{id}` | Read a feature with its parsed scenarios. | — | `FeatureView` |
| F4 | `PATCH /features/{id}` | Update content/name/slice; re-parse scenarios. | `FeatureUpdate` | `FeatureView` |
| F5 | `DELETE /features/{id}` | Delete a feature + its scenarios. | — | `204` |
| T1 | `POST /projects/{id}/test-cases` | Create a test case. | `TestCaseCreate` | `TestCaseView` |
| T2 | `GET /projects/{id}/test-cases` | List test cases (optional `?sliceId=`). | — | `TestCaseView[]` |
| T3 | `GET /test-cases/{id}` | Read a test case. | — | `TestCaseView` |
| T4 | `PATCH /test-cases/{id}` | Update a test case. | `TestCaseUpdate` | `TestCaseView` |
| T5 | `DELETE /test-cases/{id}` | Delete a test case. | — | `204` |
| G1 | `POST /projects/{id}/test-cases/generate` | AI-generate draft features/cases (not persisted). | `GenerateRequest`* | `GeneratedDraftsView` |

\* `GenerateRequest` (`{ prompt, format?, sliceId?, count? }`) and `GeneratedDraftsView`
(`{ features: FeatureDraft[], testCases: TestCaseDraft[] }`) are named request/response schemas (deviation §13).
DTO field shapes follow the keystone `*Create/*Update/*View` convention for the persisted aggregates.

---

## 7. Screen-by-screen behavior

Visual system/tokens follow the prototype extract §11 and `@gilgamesh/ui`. Below specifies *behavior*.

### 7.1 Test Lab (`/projects/{id}/lab`)
- **Slice rail** — lists the project's slices (ordered) + an "All" pseudo-slice. Create slice (key+name),
  rename, reorder (drag or up/down), delete. Selecting a slice filters the lists.
- **Authoring pane** adapts to `Project.format`:
  - **BDD** → **Features** list. Create/open a feature → a Gherkin editor (textarea) with a **parsed
    scenarios** panel that updates on save; invalid gherkin shows an inline error and does not save.
  - **TRADITIONAL** → **Test cases** list/table (key, title, priority, status, assigned agent). Create/open →
    a form (title, steps, data, expected, priority, optional agent). Both formats may be present; the format
    just chooses the default tab.
- **Generate** — a prompt box → "Generate" calls G1; results render as **review cards** (draft features/cases)
  with a per-draft **Keep** action that pre-fills the corresponding create form (F1/T1). Nothing is persisted
  until the member explicitly creates it. A busy state while generating; errors surface inline.
- Loading / empty / error states throughout; mutations send the CSRF token; reads use `credentials:'include'`.

---

## 8. Acceptance criteria

Each AC has a stable id; every Gherkin scenario in the `.feature` files is tagged with the AC id it verifies
(traceability matrix §11).

### Slices (`slices.feature`)
- **AC-SLICE-01** Create a slice with `key`+`name` persists it with the next `order`, scoped to the project.
- **AC-SLICE-02** Listing returns the project's slices in `order`.
- **AC-SLICE-03** A duplicate `key` within the same project returns `409` `Problem` (Unique(`projectId`,`key`)).
- **AC-SLICE-04** Rename and reorder (`PATCH /slices/{id}`) persist and survive reload.
- **AC-SLICE-05** Deleting a slice succeeds and **does not delete** its features/cases — they keep `sliceId=null`.
- **AC-SLICE-06** Tenant isolation: slices of a project in another `Org` return `404`.
- **AC-SLICE-07** RBAC: a `VIEWER` may list slices but create/rename/reorder/delete return `403`; `MEMBER`+ may.

### Features (`features.feature`)
- **AC-FEAT-01** Creating a feature with valid Gherkin persists it and **parses** its scenarios into ordered
  `Scenario` rows (name + order); `Scenario Outline` counts as one scenario.
- **AC-FEAT-02** Listing features returns the project's features (optionally filtered by `?sliceId=`).
- **AC-FEAT-03** Reading a feature returns its `content` + the parsed `Scenario[]` in order.
- **AC-FEAT-04** Updating a feature's `content` re-parses scenarios: added scenarios appear, removed ones are
  dropped, and reordering is reflected.
- **AC-FEAT-05** Content without a `Feature:` line or with **no** scenarios returns `422`; nothing persists.
- **AC-FEAT-06** Deleting a feature removes it and its `Scenario` rows.
- **AC-FEAT-07** Assigning a `sliceId` that belongs to a different project (or another tenant) returns `404`/`422`.
- **AC-FEAT-08** Tenant isolation: a feature of another `Org` returns `404` on read/update/delete.
- **AC-FEAT-09** RBAC: `VIEWER` read-only; create/update/delete by `VIEWER` → `403`; `MEMBER`+ may mutate.

### Test cases (`test-cases.feature`)
- **AC-TC-01** Creating a test case persists it with an auto `key`, `status=NOTRUN`, and the given
  title/steps/data/expected/priority.
- **AC-TC-02** Listing returns the project's test cases (optionally filtered by `?sliceId=`).
- **AC-TC-03** Read / update / delete a test case by id behaves correctly and persists.
- **AC-TC-04** Missing title or a `priority` not in `TestCasePriority` returns `422`.
- **AC-TC-05** `assignedAgentId` must reference an `Agent` in the org catalog; an unknown/foreign agent → `422`.
- **AC-TC-06** Tenant isolation: a test case of another `Org` returns `404`.
- **AC-TC-07** RBAC: `VIEWER` read-only; mutations by `VIEWER` → `403`; `MEMBER`+ may mutate.

### Generate (`generate.feature`)
- **AC-GEN-01** `POST …/generate` with a prompt returns draft features and/or test cases produced via
  `AgentBrainPort`; **nothing is persisted** by the call.
- **AC-GEN-02** The brain is the **stub** adapter: generation is deterministic and offline (no network),
  yielding well-formed drafts (parseable Gherkin for feature drafts; valid priority for case drafts).
- **AC-GEN-03** A `VIEWER` calling generate → `403`; unauthenticated → `401`; another tenant's project → `404`.
- **AC-GEN-04** `generate` is rate-limited per IP+account (it is a (future) cost-bearing endpoint); exceeding
  the threshold returns `429`.

---

## 9. Sensitive actions → audit (`AuditLog`)

| action | when | targetType |
|--------|------|------------|
| `slice.created` / `slice.updated` / `slice.deleted` | slice CRUD | `Slice` |
| `feature.created` / `feature.updated` / `feature.deleted` | feature CRUD (metadata: scenarioCount) | `Feature` |
| `testcase.created` / `testcase.updated` / `testcase.deleted` | test-case CRUD | `TestCase` |
| `testlab.generated` | AI generate (metadata: prompt length, counts — never the full prompt text) | `Project` |

---

## 10. Non-functional requirements

### 10.1 Performance
- **API latency (server p95):** list endpoints (`GET …/slices|features|test-cases`) **< 200 ms**; single
  create/update/delete **< 250 ms**; `generate` **< 1500 ms** with the stub (no network) — real-brain budget
  is set in the Brain slice. List endpoints resolve in **one** tenant-scoped query (no N+1); reading a feature
  joins/returns its scenarios in one round-trip.
- **Parsing:** gherkin parsing is linear in content size and runs in-process (no external call); a content
  size cap (e.g. ≤ 256 KB) bounds it.

### 10.2 Security (target OWASP ASVS L2)
- **Tenant isolation:** every query filters by the `orgId` resolved from session → `Membership`; a resource in
  another tenant returns `404` (never `403`). `sliceId`/`assignedAgentId` references are validated to be in the
  same tenant/project before use.
- **RBAC:** authoring (create/update/delete, generate) requires `MEMBER`+; `VIEWER` is read-only.
- **Input validation:** DTO whitelisting + size caps on `content`/`steps`/`prompt`; gherkin parsed safely
  (no eval); `priority` ∈ enum; `key` shape validated.
- **CSRF:** unsafe methods require the double-submit `X-CSRF-Token` (as slice 1).
- **Generate safety:** the prompt is treated as untrusted text; the stub never executes it; rate-limited
  (AC-GEN-04). Audit records prompt **length/counts**, never the raw prompt.
- **Audit:** every §9 action recorded.

### 10.3 Reliability / consistency
- Feature create/update is transactional with its scenario re-parse (the feature and its `Scenario` rows
  commit together; a parse failure rolls back).
- `Slice` delete nulls dependents' `sliceId` in the same transaction (no orphaned FK).

---

## 11. Traceability matrix (AC → scenario)

| AC | Feature file | Scenario tag |
|----|--------------|--------------|
| AC-SLICE-01 | slices.feature | `@AC-SLICE-01` Create a slice |
| AC-SLICE-02 | slices.feature | `@AC-SLICE-02` List slices in order |
| AC-SLICE-03 | slices.feature | `@AC-SLICE-03` Duplicate key conflicts |
| AC-SLICE-04 | slices.feature | `@AC-SLICE-04` Rename and reorder |
| AC-SLICE-05 | slices.feature | `@AC-SLICE-05` Delete keeps children |
| AC-SLICE-06 | slices.feature | `@AC-SLICE-06` Tenant isolation |
| AC-SLICE-07 | slices.feature | `@AC-SLICE-07` Viewer cannot mutate |
| AC-FEAT-01 | features.feature | `@AC-FEAT-01` Create and parse scenarios |
| AC-FEAT-02 | features.feature | `@AC-FEAT-02` List features |
| AC-FEAT-03 | features.feature | `@AC-FEAT-03` Read with scenarios |
| AC-FEAT-04 | features.feature | `@AC-FEAT-04` Edit re-parses |
| AC-FEAT-05 | features.feature | `@AC-FEAT-05` Invalid gherkin rejected |
| AC-FEAT-06 | features.feature | `@AC-FEAT-06` Delete removes scenarios |
| AC-FEAT-07 | features.feature | `@AC-FEAT-07` Foreign slice rejected |
| AC-FEAT-08 | features.feature | `@AC-FEAT-08` Tenant isolation |
| AC-FEAT-09 | features.feature | `@AC-FEAT-09` Viewer cannot mutate |
| AC-TC-01 | test-cases.feature | `@AC-TC-01` Create a test case |
| AC-TC-02 | test-cases.feature | `@AC-TC-02` List test cases |
| AC-TC-03 | test-cases.feature | `@AC-TC-03` Read/update/delete |
| AC-TC-04 | test-cases.feature | `@AC-TC-04` Validation |
| AC-TC-05 | test-cases.feature | `@AC-TC-05` Assign an agent |
| AC-TC-06 | test-cases.feature | `@AC-TC-06` Tenant isolation |
| AC-TC-07 | test-cases.feature | `@AC-TC-07` Viewer cannot mutate |
| AC-GEN-01 | generate.feature | `@AC-GEN-01` Generate drafts |
| AC-GEN-02 | generate.feature | `@AC-GEN-02` Deterministic offline stub |
| AC-GEN-03 | generate.feature | `@AC-GEN-03` Authz + tenant isolation |
| AC-GEN-04 | generate.feature | `@AC-GEN-04` Generate is rate-limited |

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Duplicate slice key in project | `409` `Problem` | AC-SLICE-03 |
| Delete a slice with features/cases | `204`; children keep `sliceId=null` | AC-SLICE-05 |
| Gherkin with no `Feature:`/no scenarios | `422`; nothing persists | AC-FEAT-05 |
| Edit feature content (add/remove scenarios) | scenarios re-parsed to match | AC-FEAT-04 |
| Feature assigned a foreign/other-tenant slice | `404`/`422` | AC-FEAT-07 |
| Test case with bad priority / no title | `422` | AC-TC-04 |
| Test case assigned an unknown/foreign agent | `422` | AC-TC-05 |
| Cross-tenant read of slice/feature/case | `404` (no existence leak) | AC-SLICE-06 / AC-FEAT-08 / AC-TC-06 |
| Viewer attempts any authoring or generate | `403` | AC-SLICE-07 / AC-FEAT-09 / AC-TC-07 / AC-GEN-03 |
| Generate flooded | `429` | AC-GEN-04 |

---

## 13. Deviations & open questions

**Deviations (introduced names / extensions beyond the keystone):**
- **`PATCH/DELETE /slices/{id}`, `…/features/{id}`** — the keystone §6 lists `/projects/{id}/slices`,
  `/projects/{id}/features`, `/features/{id}`; the by-id `PATCH/DELETE /slices/{id}` and the feature
  `PATCH/DELETE` are the natural CRUD completions and are added as documented path extensions.
- **`GenerateRequest` / `GeneratedDraftsView` / `FeatureDraft` / `TestCaseDraft`** — named request/response
  schemas for `…/test-cases/generate` (no `*Create/*Update/*View` analogue), listed as deviations like
  slice-1's auth request DTOs.
- **`AgentBrainPort` stub adapter** — `AgentBrainPort` is a frozen keystone §5 port; this slice adds a
  **deterministic stub** infra adapter (offline, no provider). The real Claude adapter (tiering/caching/BYOK)
  is the Brain slice. `generate` is the first consumer of the port.
- **Gherkin parser** — a pure `@gilgamesh/domain` service (no external gherkin lib required for the slice-2
  subset: `Feature:`, `Scenario:`/`Scenario Outline:`, `Background:`); listed so a later swap to the official
  `@cucumber/gherkin` AST is a contained change.

**Open questions (non-blocking; defer):**
- Does deleting a `Feature` cascade to nothing else, or should `Scenario.lastStatus` history be retained for
  reporting? (Slice 2 hard-deletes scenarios with the feature.)
- `TestCase.key` scheme when no `Slice` is set (currently `TC_PRJ_NNN`) — confirm with the Reports slice.
- Whether `generate` should optionally ground on Knowledge (RAG) — deferred to the Knowledge slice.
