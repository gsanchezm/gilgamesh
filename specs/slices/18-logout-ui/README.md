# Slice 18 — Logout UI (SDD Spec)

> Spec-Driven-Design spec for the eighteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/routes
> → **Slice-1 spec** (`specs/slices/01-auth-onboarding-agent-room/spec.md`) for the auth surface
> this slice completes (the last open item of owner decision S1-B: "the logout UI control").
> v0.1 — 2026-07-06. Status: VERIFICATION SLICE. Branch `feat-logout-ui`.

---

## 0. Honest scope statement — what already existed

Recon against the working tree shows the logout control was **already shipped end-to-end** by the
slice-7 shell work + slice 1's API; the S1-B deferral note in the docs is stale. Evidence:

| Layer | What exists | Where |
| --- | --- | --- |
| ui | "Log out" button in the sidebar foot (icon + label, tooltip when collapsed) firing `onLogout` | `packages/ui/src/Sidebar.tsx:115-118` |
| ui | `AppShell` passes `onLogout` through to the sidebar; unit test clicks it | `packages/ui/src/AppShell.tsx:14,40,60` · `AppShell.test.tsx:44-52` |
| web | `AppLayout` wires `onLogout` → `auth.logout()` (tolerates a failed server call) → `signOut()` → `navigate('/login')` | `apps/web/src/app/AppLayout.tsx:97-105,129` |
| web | `httpAuthClient.logout()` — `POST /auth/logout` with `X-CSRF-Token` + `credentials: 'include'`; unit-tested | `apps/web/src/lib/auth-client.ts:99-106` · `auth-client.test.ts:129-142` |
| web | `signOut()` clears the client session; `RequireAuth` redirects unauthed → `/login` | `apps/web/src/app/session.tsx:68` · `AppRoutes.tsx:25-29` |
| api | `POST /auth/logout` (204, `SessionAuthGuard`) revokes the session and clears **both** the `__Host-` session + csrf cookies with matching attributes | `apps/api/src/auth/auth.controller.ts:120-130,46-49` |
| api | Logout is **not** in the CSRF `PUBLIC_AUTH` exemptions → the global `CsrfGuard` enforces the double-submit on it | `apps/api/src/auth/csrf.guard.ts:9,33` · `app.module.ts:62` |
| application | `LogoutUser` revokes the session + audits `auth.logout` (no secrets); unit-tested | `packages/application/src/use-cases/session.ts:73-98` · `session.test.ts:50-67` |
| api | A revoked session is rejected by the guard (`revokedAt !== null` → 401) | `apps/api/src/auth/session-auth.guard.ts:47-53` |

**What was actually missing (the real gap this slice closes): coverage.**

1. **API e2e (Docker-free)** — `apps/api/test/auth.e2e.test.ts` had *zero* logout tests: nothing
   asserted the 204, the cookie clearing, server-side revocation (old cookie → `/auth/me` 401), or
   the CSRF gate on logout.
2. **Playwright** — no browser spec ever logged out (`apps/web/e2e/smoke.spec.ts` ends at wake-all).
3. **Web unit** — no router-level test drove the full wiring (click "Log out" in the shell →
   `auth.logout()` called → login screen; protected routes unreachable afterwards). Only the
   presentational `AppShell` callback was tested.

This slice is therefore **verification + coverage**: no product code changes are expected unless a
test exposes a real defect.

## 1. Acceptance criteria

- **AC-OUT-01** — Clicking "Log out" ends the session **server-side**: the `Session` row is revoked
  (replaying the old cookie against `/auth/me` yields 401) and the response clears the `__Host-`
  session + csrf cookies.
- **AC-OUT-02** — The SPA clears its client session state and redirects to `/login`.
- **AC-OUT-03** — After logout, `GET /auth/me` returns 401 and visiting a protected route lands on
  `/login` (the `RequireAuth` guard, exercised through a real session-restore attempt).
- **AC-OUT-04** — Logout is CSRF-protected: the existing double-submit applies (`POST /auth/logout`
  without a matching `X-CSRF-Token` → 403 `CSRF_FAILED`); the web client already sends the token.

## 2. Deliverables

- `apps/web/src/app/AppRoutes.test.tsx` — router-level logout flow test (AC-OUT-02/03 client side).
- `apps/api/test/auth.e2e.test.ts` — logout describe: 204 + cookie clearing + server-side
  revocation via the old cookie (AC-OUT-01/03) and the missing-CSRF 403 (AC-OUT-04).
- `apps/web/e2e/logout.spec.ts` — Playwright: UI login → agent room → Log out → back at `/login`,
  session cookie gone, old cookie replay → 401, protected route redirects to `/login`
  (AC-OUT-01..03). Written to run under the existing serialized e2e stack; not run in this stream.
- This spec + a docs touch-up marking the S1-B logout deferral closed.

## 3. Out of scope

- Any change to the logout semantics (revoke-current-session only; `revokeAllForUser` remains the
  reset-password behavior of slice 12).
- Logout-everywhere / session management UI.
- The disabled Google/SSO login controls (still the AC-AUTH-15 follow-up).
