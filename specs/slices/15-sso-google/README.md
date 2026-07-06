# Slice 15 — SSO / Google login (AC-AUTH-15) (SDD Spec)

> Spec-Driven-Design spec for the fifteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`, **v0.5** — this slice
> consumes the v0.5 SSO amendment: the frozen §5 `IdentityProvider` port + the §6
> `GET /auth/sso/{provider}/start` / `GET /auth/sso/{provider}/callback` routes)
> → **Decisions log** → **Slice-1 spec** (the auth surface this slice extends; closes the S1
> deferral of the disabled Google/SSO login controls).
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-07-06. Status: APPROVED FOR BDD. Branch `slice-15-sso`.

---

## 0. Owner decisions S15

**Protocol:** Google OIDC **authorization-code flow + PKCE (S256) + `state` + `nonce`**.
`provider = google` first; any other `{provider}` value → **404 Problem** (keystone §6).

**Login-or-register semantics:** the callback verifies the ID token (signature against Google JWKS,
`iss`, `aud`, `exp`, `nonce`, and **`email_verified === true` required**) →

- a `User` with that email (citext-unique) exists → **log them in**: a `Session` is created exactly
  like local login (same TTL, same `__Host-` httpOnly cookie + csrf double-submit companion) → 302 `/`.
- no `User` → **create one**: `firstName`/`lastName` from the Google profile;
  `passwordHash` = **Argon2id hash of a random 256-bit secret that is immediately discarded** (an
  *unusable* password — `passwordHash` does **not** become nullable) → log them in → 302 `/onboarding`
  (the SPA already routes authed users without an org there).
- Both paths are audited (`auth.sso.login` / `auth.sso.register`) **without tokens or secrets**.
- A `DISABLED` account cannot re-enter via SSO (same failure shape as any other callback failure).

**Platform env config:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (+ optional
`GOOGLE_REDIRECT_URL` to pin the OAuth `redirect_uri`; otherwise it is derived from the request).
When unconfigured, `/start` and `/callback` **302 → `/login?sso=unavailable`** and the web screen
shows a friendly message (see §13 for why a redirect, not a Problem body).

**Offline-first:** every suite runs without Google. `SSO_MODE=offline` (an **explicit** opt-in, set
by all test harnesses — the `BRAIN_MODE=offline` pattern) binds a deterministic
`StubIdentityProvider` (application layer) that accepts fixed codes and returns a fixed verified —
or deliberately unverified — profile. **Missing Google env WITHOUT `SSO_MODE=offline` means
UNCONFIGURED, never the stub** (deviation §13 — an auth stub reachable by accident would be a
login bypass, unlike the harmless brain stub). Belt-and-braces: the stub also refuses to activate
under `NODE_ENV=production`.

**Transaction state:** `state` + `nonce` + PKCE `code_verifier` are held **server-side** in a
short-TTL (10 min), **single-use** `SsoStateStore` keyed by the `state` value (port + in-memory
adapter now; Redis later behind the same port). Tokens (id_token / access_token / code) are **never
persisted or logged**.

---

## 1. Feature intent

Let a user sign in — or sign up — with their Google account in one click, with full OIDC security
(PKCE, state, nonce, verified email), landing new users in onboarding and existing users in the app.
Closes AC-AUTH-15 (slice-1 deferral: the Google button rendered disabled since slice 1).

---

## 2. Scope

### In scope
- Keystone §5 **`IdentityProvider`** port, created **verbatim** in
  `packages/application/src/ports/identity.ts`; concrete SSO providers return a richer completion
  result structurally compatible with the frozen `{ userId }` (the slice-9 `streamWithUsage`
  optional-extension precedent) so the transport can mint cookies.
- **`SsoStateStore`** port + `InMemorySsoStateStore` (TTL + single-use `take` + flood cap).
- **`CompleteSsoLogin`** use case: verified-profile → login-or-register → session, via the SAME
  ports local login uses (`UserRepository`, `SessionRepository`, `MembershipRepository`,
  `AuditLogRepository`, `PasswordHasher`, `TokenGenerator`, `IdGenerator`, `Clock`).
- **`StubIdentityProvider`** (application) — deterministic, offline.
- **`GoogleIdentityProvider`** (`apps/api/src/infra/google-identity-provider.ts`) — the real OIDC
  adapter; authorize-URL build, token exchange and JWKS id_token verification (via `jose`) sit
  behind small injectable seams so unit tests never touch the network.
- **Env selector** (`identityProviderFromEnv`, the slice-9 `brainFromEnv` pattern):
  `SSO_MODE=offline` → stub · Google env present → real adapter · else → unconfigured (null).
- `SsoController`: `GET /auth/sso/:provider/start` (302 → IdP authorize URL) and
  `GET /auth/sso/:provider/callback` (code exchange → session cookie → 302 into the app).
- Rate limiting: both SSO paths join the guard's `LIMITED_PATHS` (AC-AUTH-13 pattern, per-IP).
- Web: the Login **Google** control becomes a real entry (full-page navigation to
  `/api/v1/auth/sso/google/start`); `?sso=unavailable|failed` on `/login` renders a friendly
  English notice. The **SSO · SAML** button stays disabled.

### Out of scope (explicitly deferred)
- SAML / Entra / any second provider (the port + routes already accommodate them).
- Account **linking** UI (an existing local user signing in with Google simply logs in — same email).
- Refresh tokens / offline access (`access_type=offline`) — we only need the id_token once.
- ~~A Redis `SsoStateStore` adapter (multi-replica) — port-ready.~~ **CLOSED — see §14 addendum.**
- Web capability/config surface (`GET /config`) — the chosen web approach needs none.
- Sign-out at Google (RP-initiated logout).

---

## 3. Actors / personas

| Actor | Description | Slice-15 capabilities |
|-------|-------------|----------------------|
| **Anonymous visitor with a Google account** | Not registered. | One-click sign-up via Google → onboarding. |
| **Registered user** | Has an account (local or SSO-born). | One-click sign-in via Google → the app. |
| **Disabled user** (`DISABLED`) | Blocked account. | Callback fails like any other failure; no session. |
| **Attacker** | — | Cannot forge/replay `state`, swap the code (PKCE), replay an id_token (`nonce`), or discover whether an email exists from the failure shape. |

---

## 4. User stories

- **US-1** As a visitor, I click **Google**, pick my account, and land in Gilgamesh onboarding with
  an account created for me — no password to invent.
- **US-2** As an existing user, I click **Google** and I'm signed in — same session semantics as a
  password login.
- **US-3** As an operator, if Google isn't configured the button degrades gracefully (friendly
  notice, no dead ends, nothing to exploit).

---

## 5. Data contracts touched

| Entity | Slice-15 usage | Key fields exercised |
|--------|----------------|----------------------|
| **User** | read by email; **created** on first SSO sign-in. | `email`, `firstName`, `lastName`, `passwordHash` (Argon2id of a discarded random secret), `status` (`ACTIVE`). |
| **Session** | created on every successful callback (identical to local login). | `tokenHash`, `expiresAt` (7-day default TTL), `revokedAt: null`. |
| **AuditLog** | written on §9 actions. | `action`, `actorUserId`, `metadata` (never tokens/codes/secrets). |

**No schema change; no Prisma migration** (the `User` table is unchanged — `passwordHash` stays
`NOT NULL`).

**Ports (keystone §5, verbatim):**

```ts
interface IdentityProvider {                                // Local(email/pass) now; SSO/SAML/Entra later
  kind: 'LOCAL'|'OIDC'|'SAML';
  startLogin?(redirect:string): Promise<{authUrl:string}>;
  completeLogin(input: unknown): Promise<{ userId: string }>;
}
```

**New application port (not keystone — a state store is infra plumbing, like `RateLimitStore`):**

```ts
interface SsoStateEntry { nonce: string; codeVerifier: string; redirect: string; }
interface SsoStateStore {
  put(state: string, entry: SsoStateEntry, ttlMs: number): Promise<void>;
  /** Single-use claim: returns AND deletes; null when unknown, already used, or expired. */
  take(state: string): Promise<SsoStateEntry | null>;
}
```

**Determinism (stub):** `startLogin` mints state/nonce/verifier through the existing
`TokenGenerator` port and stores them; `completeLogin` accepts `stub-sso-ok` (fixed **verified**
profile `sso.stub@gilgamesh.test` / Utu Shamash) or `stub-sso-unverified` (fixed **unverified**
profile `sso.unverified@gilgamesh.test`); anything else is rejected. The stub performs the same
state take/validation as the real adapter, so state security is testable offline.

---

## 6. API operations used (keystone §6)

Base path `/api/v1`. Both routes are public (pre-session), CSRF-exempt (GET = safe method), and
rate-limited. `{provider}` = `google`; anything else → **404 Problem**.

| # | Method + path | Purpose | Response |
|---|---------------|---------|----------|
| R1 | `GET /auth/sso/{provider}/start` | Mint state+nonce+PKCE verifier, hold them server-side, redirect to the IdP. | `302 Location: <authorize URL>` · unconfigured: `302 /login?sso=unavailable` |
| R2 | `GET /auth/sso/{provider}/callback?code&state` | Claim the state (single-use), exchange the code (PKCE), verify the id_token, login-or-register, set session+csrf cookies. | `302 /onboarding` (new user) · `302 /` (existing) · failure: `302 /login?sso=failed` (no cookie) · unconfigured: `302 /login?sso=unavailable` |

Failure taxonomy on R2 (all → `302 /login?sso=failed`, indistinguishable to the browser): unknown /
expired / replayed `state` · code exchange rejected · id_token signature/`iss`/`aud`/`exp`/`nonce`
invalid · `email_verified` false/absent · `DISABLED` account. Infra faults (store down, etc.) stay
500 Problems via the global filter.

---

## 7. Screen-by-screen behavior

### 7.1 Login (`/login`) — the only screen touched
- The **Google** control (rendered disabled since slice 1) becomes an enabled link styled as the
  same secondary button, navigating full-page to `/api/v1/auth/sso/google/start`.
- `?sso=unavailable` → notice: *"Google sign-in is not available on this server yet. Use your email
  and password."*
- `?sso=failed` → notice: *"Google sign-in did not complete. Try again or use your email and
  password."*
- The **SSO · SAML** button stays disabled (`Coming soon`).
- New optional prop `sso?: string | null` (the raw query value); the route passes
  `useSearchParams().get('sso')`.

---

## 8. Acceptance criteria

- **AC-SSO-01** `GET /auth/sso/google/start` (configured) responds `302` to the IdP authorize URL
  carrying `state` and `nonce` (and, in real mode, `code_challenge` + `code_challenge_method=S256`);
  state+nonce+verifier are held server-side only (never in a client-readable artifact beyond the
  URL's own `state`/`nonce`); no session cookie is set.
- **AC-SSO-02** A callback with a valid code+state whose verified email matches an existing `ACTIVE`
  `User` creates a `Session` exactly like local login (httpOnly `__Host-` cookie + csrf companion),
  redirects `302 /`, creates **no** second `User`, and audits `auth.sso.login`.
- **AC-SSO-03** A callback for an unknown verified email **creates** the `User`
  (names from the profile, `ACTIVE`, `passwordHash` = Argon2id of a discarded random 256-bit
  secret), creates the `Session`, redirects `302 /onboarding`, and audits `auth.sso.register`. The
  minted session authenticates `GET /auth/me`.
- **AC-SSO-04** A forged, expired, or replayed `state` → `302 /login?sso=failed`, **no** session
  cookie, **no** `User` created. The state is single-use: completing once consumes it.
- **AC-SSO-05** An id_token without `email_verified === true` → `302 /login?sso=failed`; no `User`,
  no `Session`.
- **AC-SSO-06** Any provider other than `google` → **404 Problem** on both routes.
- **AC-SSO-07** With Google unconfigured (and no explicit `SSO_MODE=offline`), both routes
  `302 /login?sso=unavailable`; the login screen shows the friendly notice.
- **AC-SSO-08** Both SSO routes are rate-limited (AC-AUTH-13 pattern; per-IP fixed window) — `429`
  beyond the threshold (@wip in BDD, proven by the dedicated Docker-free e2e).
- **AC-SSO-09** A `DISABLED` account's callback fails like any other failure (`sso=failed`, no
  session).
- **AC-SSO-10 (web)** The Google control navigates to `/api/v1/auth/sso/google/start`;
  `?sso=unavailable` / `?sso=failed` render their notices; SAML stays disabled.

---

## 9. Sensitive actions → audit (`AuditLog`)

| action | when | targetType | metadata rules |
|--------|------|------------|----------------|
| `auth.sso.login` | callback signed in an existing user | `User` | `{ provider }` — never tokens, codes, or state |
| `auth.sso.register` | callback created a user and signed them in | `User` | `{ provider }` — never tokens, codes, or state |
| `auth.sso.failed` | verified-identity-level failure (unverified email, disabled account) | `User` | `{ provider, reason, email }` — never tokens, codes, or state |

> State-validation failures (forged/expired/replayed) are **not** audited — pre-identity,
> unauthenticated write amplification (the slice-12 precedent for failed resets). The rate limit
> bounds probing.

---

## 10. Non-functional requirements

### 10.1 Security
- **PKCE S256**: the verifier is a 256-bit CSPRNG base64url token (43 chars — valid RFC 7636
  charset/length); the challenge is `BASE64URL(SHA256(verifier))`; the verifier never leaves the
  server.
- **`state`**: 256-bit CSPRNG, the store key, **single-use** (`take` deletes before returning —
  a replay can never race), TTL 10 min, store capped (oldest-evicted) so a `/start` flood cannot
  grow memory unboundedly.
- **`nonce`**: 256-bit CSPRNG, held server-side, compared against the id_token claim.
- **id_token verification (real mode)**: `jose` `jwtVerify` against Google's JWKS
  (`https://www.googleapis.com/oauth2/v3/certs`), issuer `https://accounts.google.com` |
  `accounts.google.com`, audience = `GOOGLE_CLIENT_ID`, `exp` enforced by `jose`; then `nonce` and
  `email_verified` checks. The stub asserts the same *decisions* offline.
- **Token handling**: the OAuth `code`, id_token and any access token live only in request-scope
  variables — never persisted, never logged, never in audit metadata, never in error messages
  (exchange/verification failures map to fixed generic messages).
- **Unusable password**: the created user's `passwordHash` hashes a 256-bit random secret that is
  discarded in the same expression — nobody can ever present it; local login on an SSO-born account
  fails until a password reset sets a real one (deliberate, documented).
- **No enumeration surface**: every R2 failure is the same `302 /login?sso=failed`; the
  login-vs-register redirect split (`/` vs `/onboarding`) is an owner-accepted signal (Google has
  already asserted control of the email).
- **Stub safety**: stub only via explicit `SSO_MODE=offline`, refused under `NODE_ENV=production`.
- **CSRF**: GET routes are safe-method-exempt; the callback issues the csrf companion cookie the
  same way login does.
- **Cookie semantics**: unchanged single source (`session-cookies.ts`, extracted from the auth
  controller — same `__Host-`, httpOnly, Secure, SameSite=Lax attributes).

### 10.2 Performance
- `/start` is O(1) (mint + store). `/callback` in real mode = 2 HTTPS round-trips to Google (token +
  cached JWKS) + one Argon2id hash on the register path only — inside the slice-1 hashing budget.

### 10.3 Reliability
- State claims are take-first, so a double-submitted callback cannot double-register (the second
  claim finds nothing). User creation relies on the citext-unique email as the last-resort race
  guard (a concurrent duplicate becomes a 409 CONFLICT Problem — never two rows).

---

## 11. Traceability matrix (AC → scenario)

| AC | Where proven |
|----|--------------|
| AC-SSO-01 | `sso-google.feature` `@AC-SSO-01` + Google-adapter unit tests (PKCE challenge in the authorize URL) |
| AC-SSO-02 | `sso-google.feature` `@AC-SSO-02` |
| AC-SSO-03 | `sso-google.feature` `@AC-SSO-03` |
| AC-SSO-04 | `sso-google.feature` `@AC-SSO-04` (forged + replay); expiry = `InMemorySsoStateStore` unit tests (fake clock) + e2e |
| AC-SSO-05 | `sso-google.feature` `@AC-SSO-05` |
| AC-SSO-06 | `sso-google.feature` `@AC-SSO-06` |
| AC-SSO-07 | Docker-free e2e (`sso.e2e.test.ts` — the BDD app is pinned to `SSO_MODE=offline`, so the scenario is `@wip`) |
| AC-SSO-08 | Docker-free e2e (`rate-limit` pattern; BDD outline `@wip` per the slice-1/12 precedent) |
| AC-SSO-09 | `sso-google.feature` `@AC-SSO-09` |
| AC-SSO-10 | web unit tests (`LoginScreen.test.tsx`, `AppRoutes.test.tsx`) |

---

## 12. Edge cases (consolidated)

| Edge case | Expected behavior | AC |
|-----------|-------------------|-----|
| Unknown provider (`/auth/sso/okta/start`) | 404 Problem | AC-SSO-06 |
| Unconfigured Google | 302 `/login?sso=unavailable` on both routes | AC-SSO-07 |
| Forged / unknown `state` | 302 `/login?sso=failed`; nothing created | AC-SSO-04 |
| Replayed `state` (second callback) | 302 `/login?sso=failed` (single-use) | AC-SSO-04 |
| Expired `state` (> 10 min) | 302 `/login?sso=failed` | AC-SSO-04 |
| Wrong / rejected code | 302 `/login?sso=failed` | AC-SSO-02/04 |
| `email_verified: false` | 302 `/login?sso=failed`; no `User` | AC-SSO-05 |
| `DISABLED` account | 302 `/login?sso=failed`; no session | AC-SSO-09 |
| Missing profile names | fallbacks: `firstName` ← email local part, `lastName` ← `"User"` | AC-SSO-03 |
| SSO-born user tries password login | `401 INVALID_CREDENTIALS` (unusable hash) until a password reset | §10.1 |
| Existing local user uses Google (same email) | logs into the SAME account (no link step) | AC-SSO-02 |
| `/start` flood | store cap evicts oldest states; rate limit throttles per IP | AC-SSO-08 |

---

## 13. Deviations & open questions

**Deviations (documented picks):**
- **Unconfigured `/start` → `302 /login?sso=unavailable`, not a Problem body.** The owner mission
  offered "a Problem (e.g. 503 or 404 — pick and document)" but also specified the web flow "if the
  server is unconfigured it 302s back to `/login?sso=unavailable`". Both routes are top-level
  browser navigations — a JSON Problem would strand the user on a raw JSON page. The 404-Problem
  behavior is reserved for the contract violation (unknown provider, keystone §6).
- **Missing Google env ≠ stub.** The mission sketch said "SSO_MODE=offline or missing
  GOOGLE_CLIENT_ID → stub"; implemented as **explicit `SSO_MODE=offline` only** (plus refusal under
  `NODE_ENV=production`). A login stub that activates on missing config would be an authentication
  bypass in any misconfigured deployment; the harnesses all set the flag explicitly (the
  `BRAIN_MODE` pattern). Missing env → the unconfigured behavior the same mission also requires.
- **Concrete providers return a richer completion** (`{ userId, sessionToken, expiresAt,
  activeOrgId, isNewUser }`) — structurally satisfies the frozen §5 `Promise<{ userId }>`
  (the slice-9 optional-extension precedent); the port itself is verbatim.
- **`SsoStateStore` is an application port but not keystone vocabulary** — transport-security
  plumbing (the `RateLimitStore` precedent), bound in the auth module (not the persistence
  wirings): the Redis swap happens at that binding later.

**Open questions (non-blocking):**
- Account linking / "connected identities" surface (kind `OIDC` next to a local password).
- Should an SSO-born user get a "set a password" nudge? (Today: the reset-password flow works.)
- SAML (`kind: 'SAML'`) once an enterprise IdP lands; Entra ID as the second OIDC provider.
- ~~Redis `SsoStateStore` when the API goes multi-replica.~~ **CLOSED — see §14 addendum.**

---

## 14. Addendum — Redis `SsoStateStore` (2026-07-06, branch `feat-sso-redis-state`)

Closes the §2/§13 deferral: the OIDC transaction state no longer requires a single API replica.

**`RedisSsoStateStore`** (`apps/api/src/infra/redis-sso-state-store.ts`, ioredis — already a
dependency) implements the unchanged `SsoStateStore` port:

- **`put`** = one `SET sso:<state> <json> PX <ttlMs>` — expiry is **native Redis TTL** (the same
  10-min `SSO_STATE_TTL_MS` the in-memory store uses, passed by the caller), so keys self-evict
  and a `/start` flood cannot grow memory unboundedly (no explicit cap needed — the in-memory
  store's oldest-evicted cap was a Map-growth guard; here the per-IP rate limit bounds the flood
  and TTL bounds retention).
- **`take`** = one **atomic `GETDEL`** — the claim returns AND deletes in a single command, so a
  replayed `state` can never race a slow first callback **even with two concurrent callbacks on
  different API replicas** (the same take-first guarantee §10.1 demands, now cross-replica).
- **Selection** (`auth.module.ts`, the `RATE_LIMIT_STORE` idiom in `app.module.ts`): `REDIS_URL`
  set → Redis store; else the `InMemorySsoStateStore` — the Docker-free suites and dev stay
  dependency-free. No new env vars.
- **Secrecy:** the `state` value and the stored entry (nonce / PKCE verifier) are never logged
  and never embedded in an error; a corrupt stored value claims as `null`.

**Proven by:** unit tests over an injected fake redis client
(`apps/api/src/infra/redis-sso-state-store.test.ts` — the `SmtpTransport` seam idiom: prefixed
`SET … PX`, GETDEL claim, single-use, unknown → null, corrupt → null, factory + `quit` on
destroy) · one integration test against real Redis
(`apps/api/test/integration/sso-state.int.test.ts`, the `rate-limit.int.test.ts` pattern:
round-trip, concurrent-claim race → exactly one winner, native-TTL expiry) — runs with the
serialized `test:int` gate.
