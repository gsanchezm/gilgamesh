# Feature status — the product board (living)

One-glance status of the whole product: what's shipped, what's functional-but-unskinned, and what's
missing/blocked. **This is the single board** — check a box when something lands. It links to the
authoritative detail rather than repeating it, so it can't drift:

- Per-slice DoD detail → [`../../CLAUDE.md`](../../CLAUDE.md) (Slice N status sections)
- Owner decisions → [`decisions-log.md`](decisions-log.md)
- Audit remediation → [`audit-followup.md`](audit-followup.md)
- Pricing/business model → auto-memory `gilgamesh-pricing.md`

**Legend:** ✅ done (backend + UI faithful to the capture) · 🟡 functional but UI not re-skinned to the
capture / partial · 🔵 stub behind a port (runs offline; real engine pending) · 🔴 not built / blocked.

_As of 2026-07-06. Slices 1–12 are ALL merged + pushed on `main` (keystone v0.4): incl. Agent Chat
(8) + real Claude Brain w/ BYOK + metering (9) + billing 4-tier formalization (10) + chat re-skin w/
live streaming (11) + auth recovery (12), plus Reports, onboarding wizard, per-org RAG grounding,
CI hardening (SHA-pinned actions, optimized assets)._

---

## 1) Product views (the 14 design captures)

Backend = does the data/logic exist · UI = re-skinned to the `capturas/NN` target.
**To mark progress, bump the status cell** (🔴 → 🟡 → ✅).

| # | View (capture) | Backend | UI re-skin | Notes |
|---|----------------|:---:|:---:|-------|
| 01 | Login | ✅ | ✅ | |
| 02 | Register | ✅ | ✅ | |
| 03 | Pricing | ✅ | ✅ | 4-tier catalog in domain |
| 04 | Dashboard (Agent room) | ✅ | ✅ | |
| 05 | Dashboard — light theme | ✅ | ✅ | |
| 06 | Orchestration (DAG) | 🔴 | 🔴 | blocked on TOM kernel |
| 07 | Chat / voice | ✅ | ✅ | **slices 8+9+11 on `main`**: real Claude brain (BYOK per org, metering, tool registry) + capture-07 re-skin (session rail, pinned deity header, live EventSource streaming). Owner-approved screenshot. **Voice** 🔴 pending (STT/TTS) |
| 08 | Reports | ✅ | ✅ | `ReportsScreen` + `summarizeAcrossRuns`; route wired at `/projects/:id/reports` (+ Playwright e2e); per-tool "Tools" breakdown deferred |
| 09 | Knowledge base | ✅ | ✅ | + per-org upload + `.pdf`/`.docx` ingest |
| 10 | Test Lab | ✅ | ✅ | Integrated TestLabSummaryStats & refactored layout |
| 11 | Integrations | ✅ | ✅ | re-skinned to capture 11 (`08e78f9`) |
| 12 | Subscription | ✅ | ✅ | 4-tier model + capture 12 re-skin (`7632020`) |
| 13 | Session — web | 🔴 | 🔴 | needs execution timeline data |
| 14 | Session — android | 🔴 | 🔴 | Expo not started |

Extra flow screen (no dedicated capture):

- [x] Onboarding wizard — ✅ on `main` (`d58ba93`): re-skin + Company→`orgName` (AC-ONB-14; incl. a React Router 7 `startTransition` race fix so the carried company survives the authed-guard redirect). Verified: BDD 115/915 · Playwright onboarding-company e2e.

## 2) Engine / backend capabilities

Real vs. stub-behind-a-port. Swapping a stub for the real adapter is a future slice, not a rewrite.

- [x] Auth · session · CSRF · rate-limit — ✅ real (Argon2id, `__Host-` cookies, double-submit)
- [x] Persistence Prisma/Postgres + pgvector — ✅ real (per-`orgId` tenant isolation on every query)
- [x] Test Lab authoring (Slice/Feature/TestCase, Gherkin parser) — ✅ real
- [x] Integrations (github/gitlab/bitbucket/ado_repos; token never persisted) — ✅ real
- [ ] Test execution + results — 🔵 `DeterministicKernel` stub (real TOM/chaos-proxy kernel pending)
- [x] AI brain (chat · routing · draft generation) — ✅ **real `ClaudeBrain` adapter on `main` (slice 9)** behind `SelectingBrain`: real answers with `ANTHROPIC_API_KEY` (or org BYOK — call-time resolution pending `SecretVault.get()`), deterministic stub offline/CI; per-org `BrainUsage` metering + usage view + tool registry + live C3 SSE (`?live=1`)
- [x] RAG embeddings — ✅ **real Voyage `voyage-4` semantic embeddings (slice 16)** behind the frozen `AgentBrainPort.embed` + the `embedAs(texts, kind)` extension: 1024-dim `vector(1024)` column (keystone v0.5 BREAKING; destructive migration + re-ingest), real with `VOYAGE_API_KEY`, deterministic lexical FNV-1a 1024-dim offline/CI; EMBED `BrainUsage` metering (Voyage BYOK deferred)
- [x] Payments / checkout — ✅ **real Stripe (slice 13)** behind the extended `PaymentProvider` port: Checkout Sessions priced from `PLAN_CATALOG`, signature-verified webhooks over raw bytes → `Invoice` rows + subscription status (`ApplyPaymentEvent`, UoW-atomic), Invoices panel in Billing; `PAYMENTS_MODE=offline`/no `STRIPE_SECRET_KEY` → deterministic mock (CI offline). Portal/proration/refunds deferred

## 3) Missing / deferred (with the blocker)

- [ ] **Orchestration DAG canvas** — 🔴 blocked on the real TOM microkernel (keystone §7)
- [x] **Chat (text)** — ✅ slice 8 on `main` behind the stub brain (real answers + live SSE push land with the Brain slice); **voice** 🔴 still blocked on Brain/Claude + STT/TTS
- [x] **Reports** — ✅ read-only over slice-3 `Run`/`RunResult`, **route wired** at `/projects/:id/reports`; per-tool "Tools" breakdown deferred (needs a tool/discipline dimension on `RunResult`)
- [ ] **Session replay (web/android)** — 🔴 needs per-action timeline data slice-3 doesn't persist yet
- [ ] **Mobile app (Expo)** — 🔴 not started
- [x] **Forgot / reset password + Email** — ✅ slice 12 on `main`: enumeration-safe 202, sha256-only 30-min single-use token, reset revokes all sessions, `EmailPort` **real SMTP adapter on `main` (slice 17)** — nodemailer via `SMTP_URL`, credential-scrubbed errors, recording stub offline/CI; Forgot/Reset screens wired
- [x] **Google / SSO login** — ✅ **slice 15 on `main`** (AC-AUTH-15 closed): Google OIDC (PKCE+state/nonce single-use, `jose` JWKS) behind the frozen `IdentityProvider`; login-or-register with unusable password; unconfigured → button degrades (`?sso=unavailable`); stub only via explicit `SSO_MODE=offline` (refused in production). SAML still disabled
- [x] **Per-org RAG grounding** — ✅ on `main`: `GenerateDrafts` grounds on the org's own chunks (scope `shared`/NULL) + the global corpus via slot-optional `retrieveScoped`; agent-scoped chunks stay private to their agent's chat
- [x] **PDF / .docx ingest** — ✅ on `main` (`parse-document`); Knowledge now ingests `.md`/`.txt`/`.pdf`/`.docx`
- [x] **Billing → new 4-tier model** — ✅ on `main` (subscription migrated to 4-tier + `/billing` re-skinned to capture 12)

## 4) Audit remediation (see [`audit-followup.md`](audit-followup.md))

- [x] **Batch A** (input limits, body limit + 413 filter, in-mem↔Prisma order parity, cookie-name centralization) — ✅ on `main`
- [x] **#1/#2** atomic knowledge upload + chunk FKs/indexes — ✅ on `main` (via look&feel merge)
- [x] **#6/#7/#10** ListFeatures N+1 · TC-key race · batch RAG ingest — ✅ on `main` (via look&feel merge)
- [x] **R2** shared `apps/web/src/lib/http.ts` — ✅ on `main` (via look&feel merge)
- [x] **Batch C (auditoría v2)** — ✅ on `main` (`e82292c`): atomic reset-token claim (UoW) · timing-safe forgot · multer>=2.2.0 override · HNSW index + deterministic ANN query · AuthHero rAF pause · SSE withCredentials
- [ ] **Vitest 3 toolchain** — 🔴 pnpm audit critical (vitest<3.2.6 + vite/esbuild) — dev/test surface only; breaking upgrade, own stream
- [ ] **Real secret vault** — 🔴 `StubSecretVault` is in-memory; Key Vault adapter required before production BYOK
- [ ] **Bloque 3 (owner decision):** rate-limit fail-open policy · per-IP backoff (own slice) · pagination (own slice) · RAG final posture · optimize heavy assets (E5) · pin GitHub Actions to SHA
