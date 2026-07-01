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

_As of 2026-07-01. Backend slices 1–6 are on `main`; look&feel (slice 7) + the audit fixes are on
`feat/look-and-feel` and reach `main` when it merges._

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
| 07 | Chat / voice | 🔴 | 🔴 | blocked on Brain/Claude |
| 08 | Reports | 🟡 | 🔴 | data exists in Runs |
| 09 | Knowledge base | ✅ | ✅ | + per-org upload |
| 10 | Test Lab | ✅ | ✅ | Integrated TestLabSummaryStats & refactored layout |
| 11 | Integrations | ✅ | 🟡 | **← NEXT re-skin** |
| 12 | Subscription | ✅ | 🟡 | old model; 4-tier migration pending |
| 13 | Session — web | 🔴 | 🔴 | needs execution timeline data |
| 14 | Session — android | 🔴 | 🔴 | Expo not started |

Extra flow screen (no dedicated capture):

- [ ] Onboarding wizard — functional; re-skin to the prototype (`isOnboarding`) + consume Company→`orgName` = follow-on.

## 2) Engine / backend capabilities

Real vs. stub-behind-a-port. Swapping a stub for the real adapter is a future slice, not a rewrite.

- [x] Auth · session · CSRF · rate-limit — ✅ real (Argon2id, `__Host-` cookies, double-submit)
- [x] Persistence Prisma/Postgres + pgvector — ✅ real (per-`orgId` tenant isolation on every query)
- [x] Test Lab authoring (Slice/Feature/TestCase, Gherkin parser) — ✅ real
- [x] Integrations (github/gitlab/bitbucket/ado_repos; token never persisted) — ✅ real
- [ ] Test execution + results — 🔵 `DeterministicKernel` stub (real TOM/chaos-proxy kernel pending)
- [ ] AI draft generation — 🔵 `DeterministicBrain` stub (real Claude adapter pending)
- [ ] RAG embeddings — 🔵 lexical FNV-1a 1536-dim (real embeddings land with the Brain slice)
- [ ] Payments / checkout — 🔵 `MockPaymentProvider` (real Stripe + invoices/webhooks deferred)

## 3) Missing / deferred (with the blocker)

- [ ] **Orchestration DAG canvas** — 🔴 blocked on the real TOM microkernel (keystone §7)
- [ ] **Chat + voice** — 🔴 blocked on the real Brain/Claude adapter
- [ ] **Reports** — 🔴 UI; 🟡 **doable now** over slice-3 `Run`/`RunResult` (biggest unblocked opportunity)
- [ ] **Session replay (web/android)** — 🔴 needs per-action timeline data slice-3 doesn't persist yet
- [ ] **Mobile app (Expo)** — 🔴 not started
- [ ] **Forgot / reset password + Email** — 🔴 deferred (decision S1-B)
- [ ] **Google / SSO login** — 🔴 controls disabled (AC-AUTH-15)
- [ ] **Per-org RAG grounding** — 🟡 per-org chunks are stored; grounding still uses the global corpus only
- [ ] **PDF / .docx ingest** — 🔴 today only `.md`/`.txt`
- [ ] **Billing → new 4-tier model** — 🟡 `PLAN_CATALOG` in domain; backend + `/billing` screen still on the old model (migration ships with capture 12)

## 4) Audit remediation (see [`audit-followup.md`](audit-followup.md))

- [x] **Batch A** (input limits, body limit + 413 filter, in-mem↔Prisma order parity, cookie-name centralization) — ✅ on `main`
- [x] **#1/#2** atomic knowledge upload + chunk FKs/indexes — ✅ on `feat/look-and-feel`
- [x] **#6/#7/#10** ListFeatures N+1 · TC-key race · batch RAG ingest — ✅ on `feat/look-and-feel`
- [x] **R2** shared `apps/web/src/lib/http.ts` — ✅ on `feat/look-and-feel`
- [ ] **Bloque 3 (owner decision):** rate-limit fail-open policy · per-IP backoff (own slice) · pagination (own slice) · RAG final posture · optimize heavy assets (E5) · pin GitHub Actions to SHA
