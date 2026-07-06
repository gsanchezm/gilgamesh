# Slice 1 — Auth + Onboarding + Agent Room (SDD Spec)

> Spec-Driven-Design spec for the first vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Prototype extract** (`docs/research/gilgamesh-prototype-extract.md`) for screen behavior.
> All entity/field/enum/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-06-29. Status: APPROVED FOR BDD.

---

## 1. Feature intent

Give a brand-new user a complete, secure path from *zero* to a *live, per-tenant workspace whose 11 deity
agents are visible and controllable* — with **no test execution** (runs belong to later slices). Concretely:

1. **Auth (local)** — create an account, sign in, sign out, recover a forgotten password, all on local
   email/password with server-side sessions. (`IdentityProvider.kind = 'LOCAL'`.)
2. **Onboarding (3 steps)** — name a project, choose its format, optionally attach a repo. On finish, the
   system **bootstraps the tenant**: creates the root `Org`, the owner `Membership`, seeds the 11 `Agent`
   catalog rows and a trial `Subscription`, then creates the first `Project` with its 11 per-project
   `ToolBinding` rows.
3. **Agent room** — the dashboard view: the 11 seeded agents rendered as tiles, their **awake/enabled state
   and selected tool persisted per project**, individual wake/sleep, a one-click **wake-all** ("Awaken
   team"), and roster-derived **KPIs**.

This slice runs **no tests** (keystone §7: "Slice 1 runs NO tests → not blocked"), so it has zero dependency
on the `chaos-proxy` kernel, plugins, or a System-Under-Test.

---

## 2. Scope

### In scope
- Local auth: register, login, logout, `me`, forgot-password, reset-password (keystone §6 `/auth/*`).
- Session lifecycle: httpOnly cookie, server-stored `Session` (hashed token), expiry, remember-me, revoke.
- 3-step onboarding wizard and the **tenant-bootstrap** it triggers (`Org` + `Membership` + 11 `Agent` +
  `Subscription` seed + `Project` + 11 `ToolBinding`).
- Optional repo attachment as **metadata only** (`repoProvider`/`repoFullName`/`repoBranch`).
- Agent room: list agents with per-project binding + derived `AgentRuntimeStatus`; wake/sleep
  (`PATCH /projects/{id}/agents/{slot}`); tool selection (Strategy); `POST .../wake-all`; KPIs.
- Cross-cutting: per-`orgId` tenant isolation, RBAC, audit on sensitive actions, perf budgets, rate limiting.

### Out of scope (explicitly deferred)
- **Per-agent chat and push-to-talk voice** — later slice (decision #3). The `chat` view and voice bars are
  not built here.
- **Real repo OAuth / sync** — onboarding stores repo *selection metadata* only; the OAuth handshake,
  `repoCommit`/`repoLastSyncAt` population, and live sync belong to the Integrations slice.
- **SSO / SAML / Entra ID / Google sign-in** — the buttons render **disabled** (decision #10; behind the
  `IdentityProvider` port as a later adapter). No functional OAuth path in slice 1.
- **Any test execution / Orchestration / Reports / Test Lab authoring / Knowledge upload / Integrations
  management / Subscription checkout & billing UI** — later slices. `Subscription` here is a *seed only*.
- **Real email delivery** — forgot-password uses an `EmailPort`; slice 1 wires a dev/log adapter that emits
  the reset link to server logs (no SMTP).
- **i18n** — English-only; the prototype's ES/EN selector and `T()`/`setLang` machinery are removed
  (decision #2).
- **`BUSY` agent state** — derivable only from a running `RunNode`; unreachable in slice 1 (no runs).

---

## 3. Actors / personas

| Actor | Description | Slice-1 capabilities |
|-------|-------------|----------------------|
| **Anonymous visitor** | Not authenticated. | Register, login, request/perform password reset. |
| **Owner** | The registering user after bootstrap; `Membership.role = OWNER`. | Everything in this slice incl. create projects, wake/sleep agents, wake-all. |
| **Admin** (`ADMIN`) | Elevated member. | Create projects, manage agents. |
| **Member** (`MEMBER`) | Standard member. | View agent room; wake/sleep agents; wake-all. |
| **Viewer** (`VIEWER`) | Read-only member. | View agent room only; mutations → `403`. |

> Inviting other users / assigning roles (`/orgs/{orgId}/members`) is a later slice; slice 1 only *produces*
> the OWNER membership during bootstrap and *reads* role for RBAC. `Membership` and `Role` are referenced so
> the RBAC contract is exercised end-to-end.

---

## 4. User stories

- **US-1** As a visitor, I can create an account with my name, email and password, so I get a personal login.
- **US-2** As a registered user, I can sign in and stay signed in (remember me), so I reach my workspace.
- **US-3** As a user, I can sign out, so my session can no longer be used.
- **US-4** As a user who forgot my password, I can request a reset link and set a new password, so I regain
  access without revealing whether an email is registered.
- **US-5** As a newly-registered user with no workspace, I am guided through a 3-step onboarding that creates
  my organization and first project, so I land in a ready-to-use workspace.
- **US-6** As an onboarding user, I can choose my project's format (BDD or Traditional) and optionally attach
  a repo, so the workspace matches how my team works.
- **US-7** As a workspace owner, I see my 11 deity agents on the dashboard with their discipline, tool and
  status, so I understand my team at a glance.
- **US-8** As a member, I can wake or sleep individual agents and persist that choice, so the room reflects
  who is on duty.
- **US-9** As a member, I can wake the whole team in one click, idempotently, so I can quickly bring everyone
  online.
- **US-10** As a member, I can pick which tool a multi-tool agent uses (Strategy), so execution later uses my
  preferred engine.
- **US-11** As a tenant, none of my data (org, project, agents, sessions) is ever visible to another tenant.

---

## 5. Data contracts touched

All fields/types are authoritative from keystone §2/§1; this slice **reads and writes** these aggregates.

| Entity | Slice-1 usage | Key fields exercised |
|--------|---------------|----------------------|
| **User** | created at register; read at login/me. | `email`(unique, citext), `passwordHash`(Argon2id), `firstName`, `middleName?`, `lastName`, `status`(ACTIVE\|DISABLED). |
| **Session** | created at login/register; revoked at logout & on password reset. | `userId`, `tokenHash`, `expiresAt`, `ip?`, `userAgent?`, `revokedAt?`. |
| **Org** | created during onboarding bootstrap. Root tenant. | `name`, `slug`(unique). |
| **Membership** | OWNER row created at bootstrap; read for RBAC + tenant resolution. | `orgId`, `userId`, `role:Role`, Unique(`orgId`,`userId`). |
| **Project** | created at onboarding (`POST /projects`). | `orgId`, `name`, `slug`, `format:ProjectFormat`, `repoProvider?`, `repoFullName?`, `repoBranch?`, Unique(`orgId`,`slug`). |
| **Slice** | structural child of Project (Project 1→N Slice). **Not authored here** — Test Lab slice owns scenario/slice authoring. Referenced for the data contract only; slice 1 seeds none. | `projectId`, `key`, `name`, `order`, Unique(`projectId`,`key`). |
| **Agent** | seeded (the 11) into the Org catalog at bootstrap; read in agent room. | `slot:AgentSlot`, `deityName`, `role`(label), `family:AgentFamily`, `glyph`, `culture`, `defaultTool`, Unique(`orgId`,`slot`). |
| **ToolBinding** | seeded per project at onboarding (11 rows); mutated by wake/sleep/tool-select/wake-all. | `projectId`, `agentId`, `tool`, `enabled`(=awake), Unique(`projectId`,`agentId`). |
| **Subscription** | **seed only** at bootstrap. | `orgId`(unique), `plan:Plan`, `billingCycle`, `seats`, `status:SubscriptionStatus`, `runMinutesQuota`, `runMinutesUsed`. |
| **AuditLog** | written on every sensitive action (§9). | `actorUserId?`, `action`, `targetType`, `targetId?`, `metadata`, `ip?`. |

**Derived (not stored):** `AgentRuntimeStatus` per keystone §1 — `IDLE` if `!enabled`; `BUSY` if the agent is
in a running `RunNode`; else `ACTIVE`. In slice 1 there are no runs, so **`BUSY` is unreachable** and every
agent resolves to `ACTIVE` (enabled) or `IDLE` (disabled).

**Seed values (deterministic):**
- 11 `Agent` rows = roster from keystone §3 exactly (slot, deityName, family, glyph, culture, defaultTool).
- `Subscription` seed: `plan = FREE`, `status = TRIALING`, `billingCycle = MONTHLY`, `seats = 1`,
  `runMinutesQuota = 500`, `runMinutesUsed = 0` (keystone §9 FREE tier). **Trial note:** the `Agent` catalog
  is *always* the full 11 (keystone §2). While `status = TRIALING`, the org evaluates the **full 11-agent
  roster** (all may be awake). Plan limits apply to workspace/services/execution usage, not catalog seeding.
- 11 `ToolBinding` rows on project create: `tool = Agent.defaultTool`, **`enabled = true`** (all 11 Active on
  first load during the trial — documented seed default; see the trial note above, §10 edge note, and the
  decision rationale).

---

## 6. API operations used (keystone §6)

Base path `/api/v1`. Auth via httpOnly session cookie. Errors are `Problem+json` (RFC 9457). Tenant is
resolved from session → active `Membership.orgId`; every tenant-scoped list/detail filters by `orgId`.

| # | Method + path | Purpose | Request DTO | Response DTO |
|---|---------------|---------|-------------|--------------|
| O1 | `POST /auth/register` | Create `User`, issue session. | `UserCreate` | `MeView` (+ Set-Cookie) |
| O2 | `POST /auth/login` | Authenticate, issue **fresh** session. | `LoginRequest`* | `MeView` (+ Set-Cookie) |
| O3 | `POST /auth/logout` | Revoke current session. | — | `204` |
| O4 | `GET /auth/me` | Current user + memberships + active org (routing/bootstrap). | — | `MeView` |
| O5 | `POST /auth/forgot-password` | Begin reset; generic response. | `ForgotPasswordRequest`* | `202` generic |
| O6 | `POST /auth/reset-password` | Complete reset; revoke sessions. | `ResetPasswordRequest`* | `204` |
| O7 | `POST /orgs` | Bootstrap `Org` + OWNER `Membership` + seed 11 `Agent` + seed `Subscription`. | `OrgCreate` | `OrgView` |
| O8 | `GET /orgs/{orgId}` | Read org. | — | `OrgView` |
| O9 | `GET /orgs/{orgId}/agents` | Per-Org agent catalog (the 11). | — | `AgentView[]` |
| O10 | `POST /projects` | Create `Project` (+ optional repo metadata) + seed 11 `ToolBinding`. | `ProjectCreate` | `ProjectView` |
| O11 | `GET /projects/{id}` | Read project. | — | `ProjectView` |
| O12 | `GET /projects/{id}/agents` | Agents joined with per-project `ToolBinding` + derived `AgentRuntimeStatus` + KPI meta. | — | `ProjectAgentView[]` |
| O13 | `PATCH /projects/{id}/agents/{slot}` | Wake/sleep + tool selection. | `ToolBindingUpdate` | `ProjectAgentView` |
| O14 | `POST /projects/{id}/agents/wake-all` | Set `enabled=true` for all 11 (idempotent). | — | `ProjectAgentView[]` |
| O15 | `GET /orgs/{orgId}/subscription` | Read seeded subscription. | — | `SubscriptionView` |
| O16 | `GET /orgs/{orgId}/audit` | Read audit log (ADMIN/OWNER). | — | `AuditLogView[]` |

\* DTO names marked `*` (`LoginRequest`, `ForgotPasswordRequest`, `ResetPasswordRequest`) are auth request
bodies not covered by the keystone's `*Create/*Update/*View` convention; they are defined as **named request
schemas** in `openapi.v1.yaml` and listed as deviations (§13). Register reuses **`UserCreate`** as its
request body. Register, login and `/auth/me` all return **`MeView`** — the session-context view (`user` +
`memberships` + `activeOrgId`) registered in keystone §6 — not `UserView` (which is `allOf:[User]` and carries
no memberships).

---

## 7. Screen-by-screen behavior

Visual system, fonts and tokens follow the prototype extract §11 (dark default `--bg:#0A1626` …, Marcellus
for deity names, IBM Plex Sans/Mono). Below specifies *behavior*; styling is delegated to `@gilgamesh/ui`.

### 7.1 Login (`/login`)
- Fields: **email**, **password** with a show/hide toggle; **Remember me** checkbox.
- Background: helix canvas animation (decorative; lazy, must not block input — see perf budget).
- Buttons: **Sign in** (primary → O2); **Continue with Google** and **SSO / SAML** render **disabled** with a
  "Coming soon" affordance (out of scope, decision #10). Links: **Forgot password?** (→ 7.2),
  **Create account** (→ 7.4).
- On success: a **fresh** session token is issued (session-fixation defense), cookie set; client calls O4 and
  routes: **no membership → onboarding (7.5)**; **has membership → agent room (7.7)** of the most-recent
  project.
- On failure: single generic message *"Invalid email or password."* (no enumeration); failure is audited
  (without the attempted password) and rate-limited.

### 7.2 Forgot password (`/forgot-password`)
- Field: **email** → **Send reset link** (O5).
- Always returns the same generic confirmation *"If an account exists for that email, a reset link is on its
  way."* regardless of whether the email exists (no enumeration). Internally: if the user exists, a
  cryptographically-random token is generated, its **hash** stored with a short expiry, and the link is
  emitted through the `EmailPort` (dev adapter → server log).

### 7.3 Reset password (`/reset-password?token=…`)
- Fields: **new password**, **confirm password** → **Set password** (O6, body carries the token).
- Valid, unexpired, unconsumed token → set new `passwordHash` (Argon2id), **revoke all of the user's
  sessions**, consume the token, redirect to login with success notice. Invalid/expired/consumed → `400`
  with guidance to request a new link.

### 7.4 Create account (`/create-account`)
- Fields: **first name**, **middle name** (optional), **last name**, **email**, **password** (with show/hide
  + strength hint) → **Create account** (O1, `UserCreate`).
- Success: `User` created `status = ACTIVE` with an Argon2id `passwordHash`; a session is issued; user has no
  `Membership` yet → routed to onboarding (7.5).
- Duplicate email → `409` `Problem` *"That email is already registered."* (no user created; rate-limited).
- Validation (`422`): missing required name fields, malformed email, password below policy.

### 7.5 Onboarding wizard (3 steps) — `/onboarding`
Requires authentication (else `401` → login). The three **visible** steps match the prototype; the
Org is created on Finish from the optional **Company** (`orgName`) carried from register, falling back
to the project name (see deviation note in §13).

- **Step 1 — Project name (+ optional Company).** Project name required, trimmed, non-empty.
  Empty/whitespace → inline error, **Next** disabled. **Company** is optional, prefilled from the value
  collected at register (carried via router state) and editable; it becomes the `Org.name` (AC-ONB-14).
- **Step 2 — Format.** Radio: **BDD / Gherkin** or **Traditional cases** → `ProjectFormat = BDD | TRADITIONAL`.
- **Step 3 — Connect repo (optional).** Provider choice **GitHub | Bitbucket | Azure DevOps** →
  `repoProvider ∈ {github, bitbucket, ado}`, plus `repoFullName` + `repoBranch`. **Skip** is allowed.
  Stored as metadata only (no OAuth/sync in slice 1).
- **Finish** triggers the **tenant bootstrap** (transactional — all-or-nothing):
  1. If the user has **no `Membership`**: `POST /orgs` (O7) → create `Org` (name derived from the user's
     name; `slug` auto-generated + de-collided), create OWNER `Membership`, **seed the 11 `Agent`** rows from
     roster §3, **seed `Subscription`** (FREE/TRIALING). If the user **already** has a membership (second
     project), this step is **skipped** and the existing org is reused.
  2. `POST /projects` (O10) → create `Project` with `name/slug/format` (+ optional repo metadata), then seed
     **11 `ToolBinding`** rows (`tool = defaultTool`, `enabled = true`).
  3. Redirect to the **Agent room** (7.7) of the new project.
- Audited: `org.created` (when bootstrapped) and `project.created`.

### 7.6 (Pricing) — reference only
Pricing page exists in the prototype but is **not** part of slice 1's functional flow; the `Subscription` is
seeded server-side at bootstrap. Plan-selection UI / checkout is a later slice. No screen built here.

### 7.7 Agent room (dashboard view) — `/projects/{id}` (`view = dashboard`)
- On load: O12 returns the 11 agents joined with their per-project `ToolBinding` (`enabled`, `tool`) and the
  derived `AgentRuntimeStatus`, plus KPI meta.
- **Agent tile** renders: `deityName` (Marcellus), `role` label, `family` color (proceso `#A07D2C` · ui
  `#3F6FA3` · backend `#7E63A6` · guardian `#2F8F78`), `glyph`, `culture`, the selected `tool`, and a status
  badge **Active / Busy / Idle**. Idle tiles render at reduced opacity (prototype §2).
- **Wake / Sleep** a single agent → O13 `ToolBindingUpdate {enabled}`. Sleep → `enabled=false` → status
  `IDLE`; Wake → `enabled=true` → status `ACTIVE`. Persisted; survives reload.
- **Tool selection (Strategy)** → O13 `ToolBindingUpdate {tool}`. Multi-tool agents (web, api, android, ios,
  perf, visual, sec, a11y) offer their role's options (keystone §3, first = default). Single-tool agents
  (lead, arch, manual) are fixed; their tool control is read-only. A `tool` not in the role's option set →
  `422`.
- **Awaken team** (wake-all) → O14 sets `enabled=true` for all 11. **Idempotent**: when all are already awake
  it is a no-op returning `200` with no new/duplicate `ToolBinding` rows and no state change.
- **KPIs** (roster-derived, recomputed on every change): **Total agents = 11**, **Active count**, **Idle
  count**, **Busy count** (always 0 in slice 1), and **per-family distribution** (proceso/ui/backend/guardian
  counts). KPIs are computed from the agents payload (no separate endpoint).

---

## 8. Acceptance criteria

Each AC has a stable id; every Gherkin scenario in the `.feature` files is tagged with the AC id(s) it
verifies (traceability matrix in §11).

### Auth (`auth.feature`)
- **AC-AUTH-01** Register with valid `UserCreate` creates a `User` (`status=ACTIVE`, Argon2id `passwordHash`),
  issues a session cookie, and — because the user has no `Membership` — routes to onboarding.
- **AC-AUTH-02** Register with an already-registered email returns `409` `Problem`; no second `User` is
  created; the attempt is audited.
- **AC-AUTH-03** Register with invalid input (malformed email, missing first/last name, or password below
  policy) returns `422` `Problem`; no `User` is created.
- **AC-AUTH-04** Login with correct credentials issues a **new** session token (the pre-login token is not
  reused), sets an httpOnly cookie, audits `auth.login.succeeded`, and routes by membership (onboarding if
  none, else agent room).
- **AC-AUTH-05** Login with a wrong password or unknown email returns `401` with a single generic message;
  the failure is audited **without** the attempted password.
- **AC-AUTH-06** Login as a `User` with `status=DISABLED` returns `403`; no session is issued.
- **AC-AUTH-07** Login with **Remember me** sets a longer session `expiresAt` than a login without it.
- **AC-AUTH-08** Logout revokes the current `Session` (`revokedAt` set), clears the cookie, and audits
  `auth.logout`; subsequent authenticated calls with the old cookie return `401`.
- **AC-AUTH-09** `GET /auth/me` while authenticated returns `MeView` (user + embedded memberships +
  `activeOrgId`); unauthenticated it returns `401`.
- **AC-AUTH-10** Forgot-password returns the same generic `202` whether or not the email exists (no
  enumeration); when the email exists a hashed, expiring reset token is created and a link is dispatched via
  `EmailPort`; the request is audited.
- **AC-AUTH-11** Reset-password with a valid token sets a new Argon2id `passwordHash`, **revokes all** of the
  user's sessions, consumes the token, and audits `auth.password.reset`.
- **AC-AUTH-12** Reset-password with an invalid, expired, or already-consumed token returns `400`; the
  password is unchanged.
- **AC-AUTH-13** Auth endpoints (`login`, `register`, `forgot-password`) are rate-limited; exceeding the
  threshold returns `429`.
- **AC-AUTH-14** The session cookie is `httpOnly`, `Secure`, `SameSite`, `__Host-`-prefixed; state-changing
  requests are CSRF-protected.
- **AC-AUTH-15** Google and SSO/SAML controls render disabled and expose no functional sign-in path.

### Onboarding (`onboarding.feature`)
- **AC-ONB-01** Step 1 rejects an empty/whitespace project name (Next blocked / `422` on submit).
- **AC-ONB-02** Step 2 records the chosen `ProjectFormat` (`BDD` or `TRADITIONAL`).
- **AC-ONB-03** Step 3 repo connection is optional and can be skipped; a created project then has null repo
  fields.
- **AC-ONB-04** Finishing onboarding as a user with **no membership** bootstraps the tenant: an `Org` + OWNER
  `Membership` + exactly 11 `Agent` rows + one `Subscription` are created.
- **AC-ONB-05** The seeded 11 `Agent` rows match the keystone §3 roster exactly (slot, deityName, family,
  glyph, culture, defaultTool).
- **AC-ONB-06** The seeded `Subscription` is `plan=FREE`, `status=TRIALING`, `seats=1`,
  `runMinutesQuota=500`, `runMinutesUsed=0`.
- **AC-ONB-07** `POST /projects` creates the `Project` with the chosen name/format (+ optional repo metadata)
  and seeds 11 `ToolBinding` rows (`tool=defaultTool`, `enabled=true`).
- **AC-ONB-08** An `Org` `slug` collision is resolved by auto-suffixing to a unique slug (no error).
- **AC-ONB-09** A `Project` `slug` collision **within the same org** is resolved by auto-suffixing
  (Unique(`orgId`,`slug`) preserved; no error).
- **AC-ONB-10** A second onboarding by a user who **already** has a membership reuses the existing `Org` and
  creates only a new `Project` (no duplicate `Org`, `Agent`, or `Subscription`).
- **AC-ONB-11** Onboarding without authentication returns `401`; creating a project requires role
  `OWNER`/`ADMIN`.
- **AC-ONB-12** Bootstrap is transactional: if any step fails, nothing persists (no partial org/agents/
  subscription/project).
- **AC-ONB-13** Finishing onboarding redirects to the new project's agent room and audits `org.created`
  (when bootstrapped) and `project.created`.
- **AC-ONB-14** Finishing onboarding with an explicit `orgName` (the Company collected at register,
  carried via router state, editable on step 1) names the `Org` from it; a missing or whitespace-only
  `orgName` falls back to the project name. The `Org` is still created **only** at onboarding
  (AC-AUTH-01 unchanged — register creates no `Org`).

### Agent room (`agent-room.feature`)
- **AC-ROOM-01** The agent room lists exactly 11 agents with their per-project `ToolBinding` (`enabled`,
  `tool`) and derived `AgentRuntimeStatus`.
- **AC-ROOM-02** Status derivation holds: `enabled=false` → `IDLE`; `enabled=true` → `ACTIVE`; `BUSY` does not
  occur in slice 1 (no runs).
- **AC-ROOM-03** A freshly-onboarded project shows all 11 agents `ACTIVE` (seed `enabled=true`).
- **AC-ROOM-04** Sleeping an agent (`PATCH …/{slot}` `enabled=false`) persists and the agent reads `IDLE` on
  reload.
- **AC-ROOM-05** Waking an agent (`PATCH …/{slot}` `enabled=true`) persists and the agent reads `ACTIVE` on
  reload.
- **AC-ROOM-06** Selecting a tool for a multi-tool agent persists the new `ToolBinding.tool`; a tool value
  outside the role's allowed options returns `422`.
- **AC-ROOM-07** Single-tool agents (lead, arch, manual) reject tool changes (the only valid value is their
  fixed tool); the control is read-only in the UI.
- **AC-ROOM-08** `wake-all` sets `enabled=true` for all 11 agents.
- **AC-ROOM-09** `wake-all` is idempotent: invoked when all agents are already awake it returns `200`, makes
  no state change, and creates no duplicate `ToolBinding` rows.
- **AC-ROOM-10** KPIs reflect the roster: total `11`, plus Active/Idle/Busy counts and per-family
  distribution; they update after wake/sleep and wake-all.
- **AC-ROOM-11** Tenant isolation: requesting agents/bindings for a project belonging to another `Org`
  returns `404` (existence not leaked).
- **AC-ROOM-12** RBAC: a `VIEWER` may read the agent room but any mutation (`PATCH`, `wake-all`) returns
  `403`; `MEMBER`+ may mutate.
- **AC-ROOM-13** `PATCH` to a non-existent `slot` returns `404`; every wake/sleep/wake-all is audited.

---

## 9. Sensitive actions → audit (`AuditLog`)

Each writes one `AuditLog` row (`actorUserId?`, `action`, `targetType`, `targetId?`, `metadata`, `ip?`).
Never store credentials/tokens/passwords in `metadata`.

| action | when | targetType |
|--------|------|------------|
| `auth.register` | account created | `User` |
| `auth.login.succeeded` / `auth.login.failed` | login outcome (failed omits the password) | `User` (or email hash for unknown) |
| `auth.logout` | session revoked | `Session` |
| `auth.password.reset_requested` | forgot-password (only if user exists) | `User` |
| `auth.password.reset` | reset completed; all sessions revoked | `User` |
| `org.created` | bootstrap | `Org` |
| `project.created` | onboarding project create | `Project` |
| `agent.enabled.changed` | wake/sleep one agent | `ToolBinding` |
| `agent.tool.changed` | tool selection | `ToolBinding` |
| `agent.wake_all` | wake-all (records count actually changed) | `Project` |

---

## 10. Non-functional requirements

### 10.1 Performance budgets (first-class; enforced in CI per decision cross-cut)
- **API latency (server, p95):** session-reads `GET /auth/me`, `GET /projects/{id}/agents` **< 200 ms**;
  `wake-all` and single `PATCH` **< 250 ms**; onboarding bootstrap (`POST /orgs` then `POST /projects`,
  multi-write tx seeding 11+11 rows) **< 800 ms** combined. Argon2id-bearing endpoints (`login`, `register`,
  `reset-password`) **< 700 ms** p95 — Argon2id cost is *deliberate* and tuned (see 10.2), so it dominates
  and is budgeted separately from non-hashing endpoints.
- **Web vitals (Agent room, broadband):** LCP **≤ 2.5 s** (canonical — the single Agent-room LCP gated by
  Lighthouse CI, `ci-and-quality-gates.md` §5.3; `ARCHITECTURE.md` §7.1 references the same number),
  TTI **< 2.5 s**, CLS **< 0.1**. The login helix canvas is decorative and **lazy/deferred** so it never
  blocks first input.
- **Bundle:** initial JS for the auth route group **≤ 200 KB gzip**; route-level code-splitting between
  auth / onboarding / app shell.
- **Data access:** `GET /projects/{id}/agents` resolves all 11 agents + bindings in **one** query
  (join, no N+1). Indices: `User.email`(unique), `Org.slug`(unique), `Project(orgId,slug)`(unique),
  `Membership(orgId,userId)`(unique), `ToolBinding(projectId,agentId)`(unique), `Session.tokenHash`,
  `Agent(orgId,slot)`(unique). KPIs are computed from the already-fetched list (no extra round-trip).
- **Bootstrap seeding:** the 11 `Agent` + 11 `ToolBinding` inserts use batch/`createMany` inside the
  transaction.

### 10.2 Security (primordial; target OWASP ASVS L2)
- **Password hashing:** **Argon2id** with tuned parameters (e.g. ≥ 19 MiB memory, ≥ 2 iterations,
  parallelism 1, per current OWASP guidance), unique per-user salt. Never store or log plaintext.
- **Sessions:** opaque 256-bit random token in a `__Host-`-prefixed cookie — `httpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, no `Domain`. Only the token **hash** (`Session.tokenHash`) is persisted. A
  **fresh** token is issued on every successful login (session-fixation defense) and on register; logout sets
  `revokedAt`; password reset revokes **all** of the user's sessions. Default expiry short (e.g. 8 h);
  Remember-me extends it (e.g. 30 d).
- **CSRF:** state-changing requests carry a CSRF token (double-submit) in addition to `SameSite`.
- **No user enumeration:** identical responses/timing for login failures, forgot-password, and (as far as
  practical) register rate-limiting. Cross-tenant access returns **`404`**, not `403`, to avoid leaking
  existence.
- **RBAC:** `Role` checked on every mutation — project create requires `OWNER`/`ADMIN`; agent mutations
  require `MEMBER`+; `VIEWER` is read-only. The registering user becomes `OWNER` at bootstrap.
- **Tenant isolation:** every tenant-scoped query filters by the `orgId` resolved from
  session → `Membership`. No endpoint trusts an `orgId` from the client body for authorization.
- **Secrets:** none raw — any secret (e.g. future SMTP/OAuth) is a Key Vault ref. **Reset tokens carry
  ≥ 128 bits of CSPRNG entropy** (sessions are pinned at 256-bit; reset tokens are now pinned too — they
  are not weaker), are stored **only as a hash**, expire **≤ 30 min**, and are **single-use** (consumed on
  first valid use). `POST /auth/reset-password` carries a **dedicated, stricter rate limit** (independent
  of the general auth throttle) to bound token brute-force.
- **Rate limiting / lockout:** `login`, `register`, `forgot-password`, `reset-password` are throttled per
  IP + per account; abuse → `429`. **Account-lockout policy (pinned — was TBD):** after **N = 10**
  consecutive failed logins for an account/IP pair, apply **exponential backoff** plus a **temporary
  per-account-AND-per-IP lock** (e.g. 15 min, escalating) — lockout responses preserve **non-enumeration**
  (identical generic message/timing whether or not the account exists). **Anti-farming:** self-service
  `POST /orgs` creation is **bounded per user** (e.g. ≤ 3 orgs / 24 h) to prevent trial/org-farming and
  shared-quota abuse; excess → `429`.
- **Audit:** every action in §9 is recorded; audit reads (`GET /orgs/{orgId}/audit`) require `OWNER`/`ADMIN`.
- **Transport:** HTTPS only; HSTS; standard security headers.

### 10.3 Reliability / consistency
- Tenant bootstrap is a single DB transaction; partial failure rolls back entirely (AC-ONB-12).
- `wake-all` and `PATCH` are idempotent at the data layer (upsert against Unique(`projectId`,`agentId`)).

---

## 11. Traceability matrix (AC → scenario)

| AC | Feature file | Scenario tag |
|----|--------------|--------------|
| AC-AUTH-01 | auth.feature | `@AC-AUTH-01` Register a new account |
| AC-AUTH-02 | auth.feature | `@AC-AUTH-02` Register with a duplicate email |
| AC-AUTH-03 | auth.feature | `@AC-AUTH-03` Register with invalid input |
| AC-AUTH-04 | auth.feature | `@AC-AUTH-04` Sign in with valid credentials |
| AC-AUTH-05 | auth.feature | `@AC-AUTH-05` Sign in with invalid credentials |
| AC-AUTH-06 | auth.feature | `@AC-AUTH-06` Sign in as a disabled user |
| AC-AUTH-07 | auth.feature | `@AC-AUTH-07` Remember me extends the session |
| AC-AUTH-08 | auth.feature | `@AC-AUTH-08` Sign out revokes the session |
| AC-AUTH-09 | auth.feature | `@AC-AUTH-09` Who am I |
| AC-AUTH-10 | auth.feature | `@AC-AUTH-10` Request a password reset |
| AC-AUTH-11 | auth.feature | `@AC-AUTH-11` Complete a password reset |
| AC-AUTH-12 | auth.feature | `@AC-AUTH-12` Reset with an invalid token |
| AC-AUTH-13 | auth.feature | `@AC-AUTH-13` Auth endpoints are rate-limited |
| AC-AUTH-14 | auth.feature | `@AC-AUTH-14` Session cookie hardening |
| AC-AUTH-15 | auth.feature | `@AC-AUTH-15` Third-party sign-in disabled |
| AC-ONB-01 | onboarding.feature | `@AC-ONB-01` Empty project name is rejected |
| AC-ONB-02 | onboarding.feature | `@AC-ONB-02` Choose project format |
| AC-ONB-03 | onboarding.feature | `@AC-ONB-03` Skip repo connection |
| AC-ONB-04 | onboarding.feature | `@AC-ONB-04` Finish bootstraps the tenant |
| AC-ONB-05 | onboarding.feature | `@AC-ONB-05` Seeded agents match the roster |
| AC-ONB-06 | onboarding.feature | `@AC-ONB-06` Seeded subscription is a FREE trial |
| AC-ONB-07 | onboarding.feature | `@AC-ONB-07` Project create seeds tool bindings |
| AC-ONB-08 | onboarding.feature | `@AC-ONB-08` Org slug collision is suffixed |
| AC-ONB-09 | onboarding.feature | `@AC-ONB-09` Project slug collision within an org |
| AC-ONB-10 | onboarding.feature | `@AC-ONB-10` Second project reuses the org |
| AC-ONB-11 | onboarding.feature | `@AC-ONB-11` Onboarding requires auth and role |
| AC-ONB-12 | onboarding.feature | `@AC-ONB-12` Bootstrap is all-or-nothing |
| AC-ONB-13 | onboarding.feature | `@AC-ONB-13` Finish redirects and audits |
| AC-ONB-14 | onboarding.feature | `@AC-ONB-14` Explicit company names the Org / fallback to project name |
| AC-ROOM-01 | agent-room.feature | `@AC-ROOM-01` List the eleven agents |
| AC-ROOM-02 | agent-room.feature | `@AC-ROOM-02` Status derives from enabled |
| AC-ROOM-03 | agent-room.feature | `@AC-ROOM-03` Fresh project shows all active |
| AC-ROOM-04 | agent-room.feature | `@AC-ROOM-04` Sleep an agent |
| AC-ROOM-05 | agent-room.feature | `@AC-ROOM-05` Wake an agent |
| AC-ROOM-06 | agent-room.feature | `@AC-ROOM-06` Change a multi-tool agent's tool |
| AC-ROOM-07 | agent-room.feature | `@AC-ROOM-07` Single-tool agents are fixed |
| AC-ROOM-08 | agent-room.feature | `@AC-ROOM-08` Awaken the whole team |
| AC-ROOM-09 | agent-room.feature | `@AC-ROOM-09` Wake-all is idempotent |
| AC-ROOM-10 | agent-room.feature | `@AC-ROOM-10` KPIs reflect the roster |
| AC-ROOM-11 | agent-room.feature | `@AC-ROOM-11` Tenant isolation on agents |
| AC-ROOM-12 | agent-room.feature | `@AC-ROOM-12` Viewer cannot mutate |
| AC-ROOM-13 | agent-room.feature | `@AC-ROOM-13` Unknown slot and audit |

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Duplicate email on register | `409` `Problem`; no second user; audited; rate-limited | AC-AUTH-02 |
| Invalid login (wrong password / unknown email) | `401` generic; audited without password; rate-limited | AC-AUTH-05 |
| Disabled user login | `403`; no session | AC-AUTH-06 |
| Expired/consumed/invalid reset token | `400`; password unchanged | AC-AUTH-12 |
| Empty / whitespace project name | Next disabled; `422` on forced submit | AC-ONB-01 |
| Org slug collision | Auto-suffix to unique slug; success | AC-ONB-08 |
| Project slug collision within org | Auto-suffix; Unique(orgId,slug) held; success | AC-ONB-09 |
| Second onboarding (already a member) | Reuse org; only new project; no dup agents/sub | AC-ONB-10 |
| Bootstrap partial failure | Full rollback; no partial tenant | AC-ONB-12 |
| Tool value outside role options | `422` | AC-ROOM-06 |
| Tool change on single-tool agent | Rejected (fixed tool); read-only UI | AC-ROOM-07 |
| `wake-all` when all already awake | `200`; no-op; no duplicate bindings | AC-ROOM-09 |
| PATCH unknown agent slot | `404` | AC-ROOM-13 |
| Cross-tenant project/agents access | `404` (no existence leak) | AC-ROOM-11 |
| Viewer attempts mutation | `403` | AC-ROOM-12 |

---

## 13. Deviations & open questions

**Deviations (introduced names / extensions beyond the keystone):**
- **Auth request DTOs** `LoginRequest`, `ForgotPasswordRequest`, `ResetPasswordRequest` — the keystone §6
  DTO convention is `*Create/*Update/*View` (+ the named DTOs `MeView`, `ProjectAgentView`, `RunEvent`,
  `ReportView`, `Problem`). These three auth bodies have no `*Create` analogue, so they are defined as
  **named request schemas** in `openapi.v1.yaml` (and listed in `api/README.md`) and remain a documented
  deviation from that convention. Register reuses `UserCreate` as its request body; register, login and
  `/auth/me` all return **`MeView`** — the session-context view now registered in keystone §6 (it embeds
  `memberships` + `activeOrgId`, which `UserView` = `allOf:[User]` does not).
- **`EmailPort`** (dev/log adapter in slice 1) and a **password-reset token store** (hashed, expiring,
  single-use) are implied infrastructure not named in the keystone ports (§5). They sit behind the
  `IdentityProvider`/local-auth boundary. Recommend adding `EmailPort` to keystone §5 in the next revision.
- **Org naming in onboarding (revised with the slice-7 re-skin — AC-ONB-14):** the original slice-1
  deviation derived the `Org.name` with no org-name field. The re-skinned flow now collects a **Company**
  at register (slice-7 `register.feature`), carries it via **router state** to onboarding (no server-side
  persistence at register), and consumes it there: `POST /projects` accepts an optional `orgName` that
  names the `Org`; missing/blank falls back to the project name. The `Org` is still created **only** at
  onboarding bootstrap — register creates no `Org` and AC-AUTH-01 is unchanged. `slug` remains
  auto-generated/de-collided from the resolved name.
- **FREE trial unlocks the full 11-agent roster:** the seeded `Subscription` is `plan = FREE` / `TRIALING`,
  yet all 11 agents are seedable/awake. Keystone §2 fixes the catalog at 11 always; plan limits apply to
  workspace/services/execution usage, not to seeding the fixed agent catalog.

**Open questions (non-blocking; defer to later slices):**
- Org rename + slug-edit UI (settings) — which slice owns it?
- Default `Slice` seeding (e.g. an initial "Imported" slice) — currently none in slice 1; confirm Test Lab
  slice owns all `Slice` authoring.
- ~~Whether failed-login lockout should be per-account, per-IP, or both (threshold TBD).~~ **RESOLVED
  (§10.2, ASVS L2 V2.2):** both — exponential backoff + a temporary per-account-AND-per-IP lock after
  **N = 10** failures, with non-enumeration-preserving lockout responses; self-service `POST /orgs` is
  also bounded per user. Pinned before slice-1 sign-off.
