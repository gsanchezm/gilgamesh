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

_As of 2026-07-01. Slices 1–6 + look&feel (slice 7) + the audit fixes are all merged on `main`.
Latest on `main`: **Reports** view (capture 08, read-only; route wired 2026-07-05) + **PDF/.docx knowledge
parsers**. The **Onboarding wizard re-skin** (Company→`orgName`) is WIP on branch
`feature/onboarding-reskin` (`5ab3f59`, unverified, not merged)._

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
| 07 | Chat / voice | ✅ | 🟡 | **slices 8+9 on `main`**: sessions + HAIKU-routing + scoped RAG + registry-validated tools, now with the **real Claude brain** when a key is present (stub offline) + per-org metering + live C3 SSE; `ChatScreen` functional (capture re-skin, live EventSource in the client, and voice pending) |
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
- [ ] RAG embeddings — 🔵 lexical FNV-1a 1536-dim (Anthropic has no embeddings API; semantic = separate provider decision, e.g. Voyage)
- [ ] Payments / checkout — 🔵 `MockPaymentProvider` (real Stripe + invoices/webhooks deferred)

## 3) Missing / deferred (with the blocker)

- [ ] **Orchestration DAG canvas** — 🔴 blocked on the real TOM microkernel (keystone §7)
- [x] **Chat (text)** — ✅ slice 8 on `main` behind the stub brain (real answers + live SSE push land with the Brain slice); **voice** 🔴 still blocked on Brain/Claude + STT/TTS
- [x] **Reports** — ✅ read-only over slice-3 `Run`/`RunResult`, **route wired** at `/projects/:id/reports`; per-tool "Tools" breakdown deferred (needs a tool/discipline dimension on `RunResult`)
- [ ] **Session replay (web/android)** — 🔴 needs per-action timeline data slice-3 doesn't persist yet
- [ ] **Mobile app (Expo)** — 🔴 not started
- [x] **Forgot / reset password + Email** — ✅ slice 12 on `main`: enumeration-safe 202, sha256-only 30-min single-use token, reset revokes all sessions, `EmailPort` stub (real SMTP/SES later); Forgot/Reset screens wired
- [ ] **Google / SSO login** — 🔴 controls disabled (AC-AUTH-15)
- [x] **Per-org RAG grounding** — ✅ on `main`: `GenerateDrafts` grounds on the org's own chunks (scope `shared`/NULL) + the global corpus via slot-optional `retrieveScoped`; agent-scoped chunks stay private to their agent's chat
- [x] **PDF / .docx ingest** — ✅ on `main` (`parse-document`); Knowledge now ingests `.md`/`.txt`/`.pdf`/`.docx`
- [x] **Billing → new 4-tier model** — ✅ on `main` (subscription migrated to 4-tier + `/billing` re-skinned to capture 12)

## 4) Audit remediation (see [`audit-followup.md`](audit-followup.md))

- [x] **Batch A** (input limits, body limit + 413 filter, in-mem↔Prisma order parity, cookie-name centralization) — ✅ on `main`
- [x] **#1/#2** atomic knowledge upload + chunk FKs/indexes — ✅ on `main` (via look&feel merge)
- [x] **#6/#7/#10** ListFeatures N+1 · TC-key race · batch RAG ingest — ✅ on `main` (via look&feel merge)
- [x] **R2** shared `apps/web/src/lib/http.ts` — ✅ on `main` (via look&feel merge)
- [ ] **Bloque 3 (owner decision):** rate-limit fail-open policy · per-IP backoff (own slice) · pagination (own slice) · RAG final posture · optimize heavy assets (E5) · pin GitHub Actions to SHA
