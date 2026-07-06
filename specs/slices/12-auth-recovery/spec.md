# Slice 12 — Auth Recovery (forgot / reset password) (SDD Spec)

> Spec-Driven-Design spec for the twelfth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict
> → **Slice-1 spec** (`specs/slices/01-auth-onboarding-agent-room/spec.md`) for the auth surface this
> slice completes (deferred owner decision S1-B).
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.4** — this slice
> depends on the v0.4 auth-recovery amendment: `PasswordReset` §2, `EmailPort` §5, the
> `/auth/forgot-password` + `/auth/reset-password` routes §6).
> v0.1 — 2026-07-06. Status: APPROVED FOR BDD. Branch `slice-12-auth-recovery`.

---

## 0. Owner decision S12

Closes the slice-1 deferral **S1-B** (forgot/reset-password + `EmailPort`, AC-AUTH-10/11/12).
**Decision S12: `EmailPort` is wired to a deterministic stub (`StubEmail`) that RECORDS sent mail
in-memory** — the Billing `MockPaymentProvider` / slice-6 `StubSecretVault` pattern — resolvable from the
DI container (`TOKENS.Email`) so tests assert delivery without any network; it **logs nothing sensitive**
(no token, no link, no address on the server log). Real SMTP/SES is a later adapter swap behind the frozen
§5 port — no use-case or UI change. Consequences:

- **Reset token = crypto-random (256-bit CSPRNG, the `CryptoSessionTokenGenerator` pattern), stored
  HASHED only** (sha256 — exactly the `Session.tokenHash` pattern; see `session-auth.guard.ts`). The raw
  token exists only in the recorded email link (keystone §2 `PasswordReset`).
- **TTL 30 minutes** (slice-1 §10.2 pins "expire ≤ 30 min") and **single-use**: `usedAt` is set on
  consume; a consumed or expired token can never reset again.
- **Forgot-password ALWAYS answers the same generic 202** — user exists, is unknown, or is `DISABLED`:
  identical body, no enumeration. Internally a `PasswordReset` row + one recorded mail happen **only**
  for an existing `ACTIVE` account.
- **Reset revokes ALL of the user's sessions** (`SessionRepository.revokeAllForUser` — exists since
  slice 1) and sets a new Argon2id `passwordHash`.
- **Invalid / expired / consumed token → `422`** (`VALIDATION` in the repo-wide RFC9457 mapping). This
  **supersedes** the `400` drafted in the slice-1 spec/`@wip` scenarios (deviation §13).
- Audit actions are **`auth.reset.requested`** / **`auth.reset.completed`** (supersede the slice-1 §9
  draft names; deviation §13). Metadata never carries the token, the link, or any password.

---

## 1. Feature intent

Give a user who forgot their password a complete, secure, enumeration-safe path back into their
workspace: request a reset link by email → follow the link → set a new password → every old session is
dead, the new password signs in. (Keystone §6 `/auth/forgot-password` + `/auth/reset-password`; slice-1
US-4 delivered.)

---

## 2. Scope

### In scope
- `POST /auth/forgot-password` — generic `202` always; for an existing `ACTIVE` account: mint a
  crypto-random token, persist **only its hash** with a 30-minute expiry (`PasswordReset` row), dispatch
  the link through `EmailPort`, audit `auth.reset.requested`.
- `POST /auth/reset-password` — valid/unexpired/unconsumed token: set new Argon2id `passwordHash`,
  **revoke all** the user's `Session`s, consume the token (`usedAt`), audit `auth.reset.completed`,
  return `204`. Anything else → `422`, password unchanged.
- Application ports: `PasswordResetRepository` (new), `EmailPort` (frozen §5) + `StubEmail`;
  `TokenGenerator` gains `hash(token)` so the use case stays crypto-free; `UserRepository` gains the
  targeted `updatePassword` (the `linkRepo` pattern — never clobbers other columns).
- Both persistence wirings: in-memory (`InMemoryPasswordResetRepository`) and Prisma (`PasswordReset`
  model + `password_reset` migration + adapter).
- Rate limiting: both routes are throttled (already in the guard's `LIMITED_PATHS` since slice 1 — the
  slice-1 comment "forgot/reset land with slice #7" resolves here) — AC-AUTH-13.
- Web: **Forgot password?** link on Login (the control exists, unwired) → `/forgot-password`
  (`ForgotPasswordScreen`); `/reset-password?token=…` (`ResetPasswordScreen`); `AuthClient` gains
  `forgotPassword` / `resetPassword`. Pre-auth screens, always-dark, `AuthHero` layout.

### Out of scope (explicitly deferred)
- **Real email delivery** (SMTP/SES adapter; DKIM/SPF concerns) — adapter swap behind §5 `EmailPort`.
- **Account-lockout / per-IP exponential backoff** (slice-1 §10.2 N=10 policy) — its own hardening slice
  (audit Bloque 3); the fixed-window throttle applies meanwhile.
- **Email change / verification flows**; magic-link sign-in.
- **Password strength meter** beyond the existing ≥ 12 policy; breached-password (HIBP) checks.
- Invalidating outstanding reset tokens on login/password-change (documented behavior: tokens simply
  expire in ≤ 30 min; a consumed token dies immediately).

---

## 3. Actors / personas

| Actor | Description | Slice-12 capabilities |
|-------|-------------|----------------------|
| **Anonymous visitor** | Not authenticated. | Request a reset (always generic 202), complete a reset with a valid token. Both routes are public (no session, no CSRF — pre-session like login/register). |
| **Any registered user** | Has an account (`ACTIVE`). | Receives the recorded reset mail; after reset, all their sessions are revoked. |
| **Disabled user** (`DISABLED`) | Blocked account. | Gets the same generic 202; **no** token is minted, **no** mail is sent (cannot re-enter via reset). |

---

## 4. User stories

- **US-1** As a user who forgot my password, I can request a reset link and set a new password, so I
  regain access without revealing whether an email is registered (slice-1 US-4).
- **US-2** As a user completing a reset, every session I had anywhere is signed out, so a stolen cookie
  dies with the old password.
- **US-3** As an attacker, I cannot tell from `/auth/forgot-password` whether an email exists, replay a
  used token, use an expired one, or brute-force tokens (rate-limited + 256-bit entropy + hash-only
  storage).

---

## 5. Data contracts touched

| Entity | Slice-12 usage | Key fields exercised |
|--------|----------------|----------------------|
| **PasswordReset** | **new** — created on forgot, consumed on reset. | `id`, `userId`, `tokenHash`, `expiresAt`, `usedAt?`, `createdAt` (keystone §2 verbatim). |
| **User** | read by email (forgot) / by id (reset); `passwordHash` replaced on reset. | `email`, `status`, `passwordHash`(Argon2id), `updatedAt`. |
| **Session** | **all** the user's rows revoked on reset. | `userId`, `revokedAt`. |
| **AuditLog** | written on §9 actions. | `actorUserId`, `action`, `targetType`, `targetId`, `metadata` (never secrets). |

**Ports (keystone §5):** `EmailPort.send({ to, subject, text })` — frozen signature, verbatim.
`PasswordReset` joins the §5 repository list (already amended in v0.4).

**Determinism:** `StubEmail` records `{ to, subject, text }` in-memory in call order; the reset link in
`text` is `/reset-password?token=<raw>` (SPA route), so acceptance tests parse the raw token from the
recorded mail — never from the DB (which only ever has the hash).

---

## 6. API operations used (keystone §6)

Base path `/api/v1`. Public endpoints (pre-session): no session cookie required, CSRF-exempt like
login/register, rate-limited. Errors are `Problem+json` (RFC 9457).

| # | Method + path | Purpose | Request DTO | Response |
|---|---------------|---------|-------------|----------|
| R1 | `POST /auth/forgot-password` | Begin reset; generic response always. | `ForgotPasswordRequest`* (`email`) | `202` `{ message }` (fixed generic text) |
| R2 | `POST /auth/reset-password` | Complete reset; revoke sessions; consume token. | `ResetPasswordRequest`* (`token`, `newPassword`) | `204` |

\* Named request schemas — the slice-1 §13 deviation already registers `ForgotPasswordRequest` /
`ResetPasswordRequest` outside the `*Create/*Update/*View` convention.

Generic 202 text (fixed): **"If an account exists for that email, a reset link is on its way."**
DTO bounds from `INPUT_LIMITS`: `email ≤ emailMax(254)`; `token ≤ resetTokenMax(256)`;
`newPassword` `passwordMin(12) ≤ len ≤ passwordMax(200)`.

---

## 7. Screen-by-screen behavior

Pre-auth screens: always-dark, `AuthHero` split layout (the Login/Register pattern), English-only.

### 7.1 Login (`/login`) — one wiring change
- The existing **Forgot your password?** control navigates to `/forgot-password` (it rendered unwired
  since the slice-7 re-skin).

### 7.2 Forgot password (`/forgot-password`) — `ForgotPasswordScreen`
- Field: **email** → **Send reset link** (R1). Client-side: syntactically valid email required.
- On submit (success or 4xx-free): swap the form for the generic confirmation *"If an account exists for
  that email, a reset link is on its way."* — the screen never distinguishes outcomes.
- Links: **Back to sign in** → `/login`.
- Presentational: `{ authClient, onSignIn? }` props, injectable client per the repo idiom.

### 7.3 Reset password (`/reset-password?token=…`) — `ResetPasswordScreen`
- Fields: **new password** (show/hide), **confirm password** → **Set new password** (R2; the token comes
  from the query string).
- Client-side: password ≥ 12 chars, confirm must match. Missing token → the invalid-link message with a
  **Request a new link** path (→ `/forgot-password`).
- `204` → success notice + **Go to sign in** (→ `/login`). `422` → *"That reset link is invalid or has
  expired."* + the request-a-new-link path.
- Presentational: `{ authClient, token, onSignIn?, onRequestNew? }` props.

---

## 8. Acceptance criteria

AC-AUTH-10/11/12/13 are **reused verbatim from slice 1** (they were reserved for this surface);
AC-REC-* are the recovery-specific criteria this slice adds. Traceability in §11.

- **AC-AUTH-10** Forgot-password returns the same generic `202` whether or not the email exists (no
  enumeration); when the email exists a hashed, expiring (≤ 30 min) reset token is created and a link is
  dispatched via `EmailPort`; the request is audited (`auth.reset.requested`).
- **AC-REC-01** Forgot-password for an unknown email returns the **identical** generic `202`; **no**
  `PasswordReset` row is created and **no** mail is recorded.
- **AC-AUTH-11** Reset-password with a valid token sets a new Argon2id `passwordHash`, **revokes all** of
  the user's sessions, consumes the token (`usedAt` set), and audits `auth.reset.completed`; the old
  password stops working and the new password signs in.
- **AC-REC-02** A consumed token cannot be reused: the second `POST /auth/reset-password` with the same
  token returns `422` and the password is unchanged (single-use).
- **AC-AUTH-12** Reset-password with an expired or unrecognized token returns `422`; the password is
  unchanged.
- **AC-REC-03** Only the token **hash** is persisted: the `PasswordReset` row carries `tokenHash` =
  sha256(raw), never the raw token; the raw token appears only in the `EmailPort` mail; audit metadata
  carries neither token nor password.
- **AC-AUTH-13** `/auth/forgot-password` and `/auth/reset-password` are rate-limited; exceeding the
  threshold returns `429` (@wip in BDD, per the slice-1 pattern — proven by the dedicated guard e2e).
- **AC-REC-04** Weak `newPassword` (below the 12-char policy) returns `422` and neither consumes the
  token nor changes the password.
- **AC-REC-05 (web)** Login links to `/forgot-password`; `/forgot-password` always shows the generic
  confirmation after submit; `/reset-password?token=…` submits the token with the new password and routes
  back to sign-in on success.

---

## 9. Sensitive actions → audit (`AuditLog`)

| action | when | targetType | metadata rules |
|--------|------|------------|----------------|
| `auth.reset.requested` | forgot-password minted a token (existing ACTIVE account only) | `User` | `{}` — never the email-or-not verdict, token, or link |
| `auth.reset.completed` | reset succeeded; all sessions revoked | `User` | `{}` — never the token or any password |

> Supersedes the slice-1 §9 draft names `auth.password.reset_requested` / `auth.password.reset`
> (deviation §13). No audit row for unknown-email requests (writing one per probe would be an
> unauthenticated write amplifier) nor for failed resets (rate limit bounds probing).

---

## 10. Non-functional requirements

### 10.1 Security (slice-1 §10.2 obligations discharged here)
- **Token entropy:** 256-bit CSPRNG (`randomBytes(32)`, base64url) — above the pinned ≥ 128-bit floor;
  same generator class as sessions.
- **Hash-only storage:** sha256 hex in `PasswordReset.tokenHash` (unique index); raw token never
  persisted, logged, or audited.
- **TTL ≤ 30 min**, **single-use** (`usedAt` on consume; consumed wins over everything — checked before
  expiry so a replay is always `422`).
- **No enumeration:** fixed 202 body for all inputs; `DISABLED` accounts get no token (a reset must not
  resurrect a blocked account); the response never varies.
- **Session revocation:** reset revokes **all** sessions (`revokeAllForUser`) — stolen-cookie kill.
- **Rate limiting:** both routes throttled per (path + IP + email) — the slice-1 fixed-window guard;
  the stricter dedicated reset limit from slice-1 §10.2 stays deferred with the lockout slice.
- **CSRF:** exempt (public, pre-session — `PUBLIC_AUTH` since slice 1); the session-fixation surface is
  nil (no session issued by either route).
- **Argon2id** for the new `passwordHash`; the ≥ 12-char policy enforced at DTO **and** use case.

### 10.2 Performance
- Both endpoints are single-row lookups + O(1) writes; `reset-password` carries one Argon2id hash —
  inside the slice-1 hashing budget (< 700 ms p95). `PasswordReset.tokenHash` is uniquely indexed.

### 10.3 Reliability
- `reset-password` claims the token (`usedAt`) **before** rewriting the password, so a double-submit of
  the same token can never double-apply; writes are per-row and idempotent in effect.

---

## 11. Traceability matrix (AC → scenario)

| AC | Feature file | Scenario tag |
|----|--------------|--------------|
| AC-AUTH-10 | auth-recovery.feature | `@AC-AUTH-10` Request a reset for an existing account / generic response outline |
| AC-REC-01 | auth-recovery.feature | `@AC-REC-01` Unknown email leaves no trace |
| AC-AUTH-11 | auth-recovery.feature | `@AC-AUTH-11` Complete a password reset |
| AC-REC-02 | auth-recovery.feature | `@AC-REC-02` A consumed token cannot be reused |
| AC-AUTH-12 | auth-recovery.feature | `@AC-AUTH-12` Expired and unrecognized tokens are rejected |
| AC-REC-03 | auth-recovery.feature | `@AC-REC-03` Only the token hash is stored |
| AC-AUTH-13 | auth-recovery.feature | `@AC-AUTH-13` Recovery endpoints are rate-limited (@wip) |
| AC-REC-04 | auth-recovery.feature | `@AC-REC-04` Weak new password is rejected |
| AC-REC-05 | (web unit tests: LoginScreen / ForgotPasswordScreen / ResetPasswordScreen / AppRoutes) | — |

The slice-1 `@wip` scenarios `@AC-AUTH-10/11/12` (+ the forgot-password row of its `@AC-AUTH-13`
outline) in `01-auth-onboarding-agent-room/auth.feature` are **superseded** by this feature file and
remain `@wip` (excluded from the sweep) as historical drafts.

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Unknown email on forgot | Identical generic 202; no row; no mail | AC-REC-01 |
| `DISABLED` account on forgot | Identical generic 202; no row; no mail | AC-AUTH-10 |
| Expired token (> 30 min) | `422`; password unchanged | AC-AUTH-12 |
| Garbage / unrecognized token | `422`; password unchanged | AC-AUTH-12 |
| Replay of a consumed token | `422`; password unchanged (stays the reset one) | AC-REC-02 |
| Weak newPassword with a valid token | `422`; token NOT consumed; password unchanged | AC-REC-04 |
| Two forgot requests for one account | Two independent tokens; each single-use; both expire ≤ 30 min | AC-AUTH-10 |
| Reset while sessions are live elsewhere | All revoked; old cookies get `401` | AC-AUTH-11 |
| Threshold exceeded on either route | `429` + `Retry-After` | AC-AUTH-13 |

---

## 13. Deviations & open questions

**Deviations:**
- **`422` (not `400`) for invalid/expired/consumed tokens.** The slice-1 spec (AC-AUTH-12) and its
  `@wip` draft scenarios said `400`; the repo-wide RFC9457 mapping (`DomainExceptionFilter`) renders
  `VALIDATION → 422` and every comparable rejection in the codebase is 422. Owner mission for slice 12
  pins 422. Slice-1's `@wip` drafts stay untouched/excluded (see §11).
- **Audit action names** `auth.reset.requested` / `auth.reset.completed` supersede slice-1 §9's draft
  `auth.password.reset_requested` / `auth.password.reset` (owner mission wording; no audit consumer
  exists yet, so no migration).
- **`TokenGenerator.hash(token)`** — the slice-1 application port gains a hash-a-presented-token method
  so reset verification stays out of the use case's hands (crypto lives in infra; the fake stays
  deterministic). Not a keystone port; no keystone change needed.
- **`ForgotPasswordRequest` / `ResetPasswordRequest`** are already-registered slice-1 §13 deviations.

**Open questions (non-blocking):**
- Should a successful login invalidate outstanding reset tokens? (Currently: they just expire.)
- The stricter *dedicated* reset-password rate limit + account lockout (slice-1 §10.2) — lands with the
  backoff/lockout hardening slice (audit Bloque 3).
- Real mail adapter choice (SES vs SMTP relay) + link base URL config for non-SPA contexts.
