# Gilgamesh API v1 — Contract Index

OpenAPI **3.1** contract: [`openapi.v1.yaml`](./openapi.v1.yaml). This is a **design/spec artifact**
(not generated, not served). It expands the Foundation Keystone
(`../_keystone/foundation-vocabulary.md`, §6) into a full HTTP contract. All entity names, field
names, enum values, agent slot ids and resource paths are taken **verbatim** from the keystone.

- **Base path:** `/api/v1` (every path below is relative to it).
- **Media types:** `application/json`; errors `application/problem+json`; run stream `text/event-stream`;
  uploads `multipart/form-data`.
- **Detail level:** endpoints marked **FULL** are fully specified (schemas, status codes, examples,
  auth); endpoints marked **OUTLINE** carry `TODO: expand` and a `$ref` to their View schema.

## Conventions

### Authentication
- Primary security scheme: **session cookie** `__Host-gg_session` (`apiKey` in `cookie`). The `__Host-`
  prefix structurally forces `Secure`, `Path=/`, and **no** `Domain`. httpOnly + Secure + SameSite=Lax.
  Issued by `POST /auth/login` and `POST /auth/register`; cleared by `POST /auth/logout`.
- Applied globally. The only public operations are `/auth/register`, `/auth/login`,
  `/auth/forgot-password`, `/auth/reset-password` (each declares `security: []`).
- Local email/password (Argon2id) for slice 1; swappable to OIDC/SAML later behind the
  `IdentityProvider` port — no contract change for consumers.

### CSRF (cookie auth)
- Cookie auth alone is **not** sufficient for state-changing requests. Every **unsafe** method
  (`POST`/`PATCH`/`PUT`/`DELETE`) MUST carry a **double-submit CSRF token**: the `X-CSRF-Token` request
  header (`csrfToken` security scheme) whose value equals a non-HttpOnly `csrf` cookie set alongside the
  session cookie. `SameSite=Lax` is a defense-in-depth layer, not the sole control (ASVS L2 V4.2).
- A missing/mismatched token → `403` (`code: CSRF_FAILED`). Safe methods require no token. Mirrors
  slice-1 §10.2 / AC-AUTH-14.

### CORS
- Browser clients (`apps/web`, `apps/mobile`) are served under an explicit **origin allowlist**
  (the deployed web/mobile origins; pinned here and configured in `apps/api` middleware). The server
  returns `Access-Control-Allow-Credentials: true` **only** for those exact origins and **never**
  `Access-Control-Allow-Origin: *` together with credentials. Verified by the DAST CORS-allowlist gate
  (ci-and-quality-gates.md §7).

### Tenancy & RBAC (security is primordial)
- **Every request resolves the tenant from the session → `orgId`.** Every list/detail query is
  filtered by that `orgId` (row-level isolation). `orgId` is **never** accepted in a request body.
- For `/orgs/{orgId}/...` paths the path `orgId` is additionally checked against the caller's
  memberships. A **non-member** receives `404` (the org's existence is not leaked — slice-1 §10.2);
  a member with an **insufficient role** receives `403`. (`403` is reserved for same-tenant
  insufficient-role; cross-tenant access is always `404`.)
- `*Create` / `*Update` bodies never accept `orgId`, `id`, `createdAt`, or `updatedAt`
  (server-assigned). Server-only secrets (`passwordHash`, `tokenHash`, `secretRef`, `embedding`,
  `storageKey`) are never serialized in any response.
- **RBAC roles:** `OWNER | ADMIN | MEMBER | VIEWER`. Each write operation documents the minimum role;
  org/member/integration/subscription mutations require OWNER or ADMIN. Insufficient role → `403`.
  **Least-privilege reads:** integration / subscription / audit reads also require ADMIN or OWNER
  (their `connected`/`config`/billing/audit fields are not exposed to MEMBER/VIEWER). Every OUTLINE
  read declares explicit `401`/`403`/`404` responses (deny-by-default), not just `default`.
- Artifact blobs are never public: `GET /artifacts/{id}` returns a **short-lived signed URL**
  (`url` + `urlExpiresAt`, default TTL 300 s, capped 3600 s). Sensitive actions are written to the
  audit log.

### Errors (RFC 9457)
- All non-2xx responses use `application/problem+json` with the `Problem` schema:
  `type, title, status, detail?, instance?, code?, errors[]?`.
- `code` is a stable machine-readable token (e.g. `VALIDATION_FAILED`, `RATE_LIMITED`, `CONFLICT`).
- Common reusable responses: `400, 401, 403, 404, 409, 422, 429` and a `default` (500).
  `POST /projects/{id}/runs` may also return `402` when the run-minutes quota is exhausted.

### Pagination
- **Cursor-based.** List endpoints accept `cursor` (opaque) + `limit` (1–100, default 20).
- List responses are `{ "data": [ ... ], "page": PageMeta }` where
  `PageMeta = { nextCursor: string|null, hasMore: boolean, limit: integer }`.
- Pass the previous response's `page.nextCursor` as the next request's `cursor`.

### Rate limiting
- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch s).
- `429` additionally carries `Retry-After`.

### Real-time (SSE)
- `GET /runs/{id}/events` is a `text/event-stream` of `RunEvent` objects
  (`NODE_STATE | LOG | ARTIFACT | SUMMARY`, discriminated by `type`). The SSE `event:` field mirrors
  `RunEvent.type`. Supports `Last-Event-ID` resumption; heartbeat ≤ 15 s; stream closes on terminal
  run status (`DONE | FAILED | CANCELED`).

### Versioning
- Breaking changes ship under a new base path (`/api/v2`). v1 is additive-only; new optional fields
  and new endpoints may appear without a major bump.

### IDs, time, JSON casing
- IDs: UUID v7 strings. Timestamps: RFC 3339 UTC. JSON: camelCase fields. Enums per keystone §1
  (agent slots and integration keys are stable lowercase; all other enums SCREAMING_SNAKE).

### Performance budgets (enforced in CI)
- GET detail p95 ≤ 200 ms; list p95 ≤ 400 ms (page ≤ 50); writes p95 ≤ 500 ms.
- `POST /projects/{id}/runs` returns `202` (enqueue only) in ≤ 300 ms. SSE budgets use the canonical set
  (single source: `run-lifecycle.md` §7): connect p95 ≤ 200 ms, event fan-out p95 ≤ 250 ms,
  time-to-first-event p95 ≤ 1.5 s.

## Surface map

| Area | Paths | Detail |
|------|-------|--------|
| **auth** | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `POST /auth/forgot-password` · `POST /auth/reset-password` | FULL |
| **orgs** | `GET,POST /orgs` · `GET,PATCH /orgs/{orgId}` | FULL |
| **members** | `GET,POST /orgs/{orgId}/members` · `PATCH,DELETE /orgs/{orgId}/members/{id}` | FULL |
| **projects** | `GET,POST /projects` (POST = onboarding) · `GET,PATCH,DELETE /projects/{id}` | FULL |
| **agents** | `GET /orgs/{orgId}/agents` (catalog) · `GET /projects/{id}/agents` · `PATCH /projects/{id}/agents/{slot}` · `POST /projects/{id}/agents/wake-all` | FULL |
| **runs** | `GET,POST /projects/{id}/runs` (POST = enqueue) · `GET /runs/{id}` · `GET /runs/{id}/events` (SSE) · `POST /runs/{id}/cancel` · `GET /runs/{id}/nodes/{nodeId}` | FULL |
| **reports** | `GET /runs/{id}/report` · `GET /runs/{id}/report/tools/{tool}/cases` (paginated drill-down) | FULL |
| **artifacts** | `GET /artifacts/{id}` (signed URL) | FULL |
| **slices** | `GET,POST /projects/{id}/slices` | OUTLINE |
| **features** | `GET,POST /projects/{id}/features` · `GET,PATCH,DELETE /features/{id}` | OUTLINE |
| **test-cases** | `GET,POST /projects/{id}/test-cases` · `GET,PATCH,DELETE /test-cases/{id}` · `POST /projects/{id}/test-cases/import` · `POST /projects/{id}/test-cases/generate` | OUTLINE |
| **integrations** | `GET /orgs/{orgId}/integrations` · `PATCH /orgs/{orgId}/integrations/{key}` | OUTLINE |
| **knowledge** | `GET,POST /projects/{id}/knowledge` · `DELETE /projects/{id}/knowledge/{docId}` | OUTLINE |
| **subscription** | `GET /orgs/{orgId}/subscription` · `POST /orgs/{orgId}/subscription/checkout` | OUTLINE |
| **audit** | `GET /orgs/{orgId}/audit` | OUTLINE |

## Schemas (`components.schemas`)

- **Entities (keystone §2, verbatim fields):** `Org, User, Membership, Session, Project, Slice,
  Feature, Scenario, TestCase, Agent, ToolBinding, Run, RunNode, Artifact, Integration, Subscription,
  KnowledgeDoc, KnowledgeChunk, AuditLog`.
- **DTOs:** `*View` (responses), `*Create` (POST bodies), `*Update` (PATCH bodies) for the resources
  above, plus `RunEvent` (+ `NODE_STATE/LOG/ARTIFACT/SUMMARY` variants), `ReportView`, `ReportCase`,
  `MeView`, `ProjectAgentView`, the auth request bodies `LoginRequest` / `ForgotPasswordRequest` /
  `ResetPasswordRequest`, `PageMeta`, and `Problem` (RFC 9457).

> **Deviations from the keystone §6 enumerated set (additive, documented like the auth DTOs in
> slice §13):**
> - **`ReportCase` schema** — names the previously-inline `ReportView.tools[].cases[]` shape so it can be
>   reused; it is an **extraction of existing `ReportView` internals**, not new vocabulary.
> - **`GET /runs/{id}/report/tools/{tool}/cases`** — an additive **pagination split** of the enumerated
>   `/runs/{id}/report` (the unbounded drill-down extracted to a cursor-paginated sub-resource for the
>   perf budget). No new entity/enum; the parent report path is unchanged.
> - **`RunEventArtifact` wire shape carries `artifactId`, not `storageKey`** — the SSE serialization +
>   relay diverge from the keystone §5 *internal* port event (which keeps `storageKey`); the keystone is
>   **not** changed. See `run-lifecycle.md` §5/§10.6.
- **Enums (keystone §1, verbatim):** `Role, ProjectFormat, AgentSlot, AgentFamily, AgentRuntimeStatus,
  TestCasePriority, TestCaseStatus, RunStatus, RunMode, RunTrigger, RunNodeKind, RunNodeState,
  ArtifactType, CaptureMode, IntegrationGroup, Plan, BillingCycle, SubscriptionStatus,
  KnowledgeDocStatus, BrainTier`.

## Validation

The contract is self-contained (no external `$ref`). It parses as YAML and every internal `$ref`
resolves to a defined component (0 missing); all 19 keystone entities and the required DTOs
are present; enums match keystone §1 byte-for-byte; no `*Create`/`*Update` body accepts
`orgId`/`id`/timestamps; sensitive fields are absent from all views. (Validated by parsing the
data file only — no application code is run.)
