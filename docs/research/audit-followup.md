# Audit follow-up — tracking (living)

Triage + execution status of the codebase audit. Updated as work lands. Items needing the owner's
call are in **§ Pending owner decision** — they change behavior/contracts or are infra.

**Branch map (owner decision, 2026-07-01):** Batch A is **merged to `main`** (independent, contract-stable).
`#1`/`#2` (knowledge integrity), **Batch B** (`#6`/`#7`/`#10`) and **R2** landed on **`feat/look-and-feel`**
and reach `main` when that branch merges (*ride look&feel*; `#10` is entangled with look&feel's per-org
knowledge schema, so it cannot be decoupled to `main` on its own). Batch A was cut on
`refactor/audit-hardening`, now redundant — safe to delete once `main` is pushed.

## Done — Batch A (safe, contract-stable) ✅ merged to `main`

| # | Item | What landed |
|---|------|-------------|
| 1 | Bound auth inputs | `@MaxLength` on Register/Login DTOs (email/names/password), driven from `INPUT_LIMITS`. Rejected before argon2 cost. |
| 2 | Deterministic body limit | `configureBodyParser()` → 512 KiB JSON/urlencoded (> 256 KiB `feature.content`), same source as DTOs; wired in `main.ts`. Filter now preserves body-parser 413/400 (was masked as 500). |
| 8 | In-memory ↔ Prisma order parity | In-memory adapters sort like Prisma (features `createdAt,id` asc · test cases `key` asc · runs `createdAt,id` desc). |
| R | Centralize constants | `common/input-limits.ts` + `auth/cookie-names.ts` (cookie names were duplicated ×3). |

Verification: typecheck + lint clean · api 83 + application 138 Docker-free · `test:int` 14 ·
BDD 94 scenarios / 739 steps (Postgres + Redis).

## Done — knowledge integrity + Batch B + R2 ✅ on `feat/look-and-feel`

Built SDD/TDD (real RED→GREEN at unit + integration), all green:
`409 Docker-free · test:int 19 · BDD 94 · typecheck · lint`.

| # | Item | What landed | Commit |
|---|------|-------------|--------|
| 1 | Atomic knowledge-document upload | `UploadKnowledgeDocument` wraps document + chunks in one `UnitOfWork.transaction` (document written first so the `document_id` FK holds); `Repositories` bundle gains `knowledge`/`knowledgeDocuments`. No more orphaned chunks. | `89d5ca2` |
| 2 | FKs on `knowledge_chunks` | Migration adds FK `org_id → orgs` and `document_id → knowledge_documents` (`ON DELETE CASCADE`, nullable for the global corpus) + indexes (`document_id`, composite `org_id,document_id`); purges pre-existing orphans first. | `89d5ca2` |
| 7 | Deterministic TC-key under concurrency | Prisma `create` maps `P2002` → domain `CONFLICT`; `CreateTestCase` re-reads + retries with the next key (bounded). Verified with a real-concurrency `test:int`. | `3130c12` |
| 6 | N+1 in `ListFeatures` | New `ScenarioRepository.countByFeature` (one grouped `groupBy`) on both adapters; `ListFeatures` no longer queries per feature. | `3130c12` |
| 10 | Batch RAG ingest | `upsertMany` → one multi-row `INSERT … ON CONFLICT` per 500-row batch (`Prisma.join`) instead of a round-trip per chunk. | `3130c12` |
| R2 | Centralize web fetch helpers | `apps/web/src/lib/http.ts` (`API_BASE`, `ok`, `getJson`, `sendJson`); the 8 clients import instead of redeclaring (−79 net lines, no behavior change). | `e6beb7c` |

## Done — Batch C (2026-07-06) ✅ on `feat-audit-batch-c`

Six audit-hardening quick wins, owner-approved 2026-07-06. Built TDD red-first (one commit per fix),
all green Docker-free: `typecheck · lint · pnpm -r test` (the orchestrator runs the serialized
`test:int`/BDD/Playwright gates and deploys the new migration first).

| # | Item | What landed | Files |
|---|------|-------------|-------|
| 6 | Atomic reset-token claim | `PasswordResetRepository.markUsed` → **`claimUnused(id, at): Promise<boolean>`** (conditional `usedAt: null` in the adapter's WHERE — Prisma `updateMany` count===1, in-memory synchronous check-and-set); `ResetPassword` runs find→validate→claim→rewrite→revoke-all→audit inside ONE `UnitOfWork` transaction, so a concurrent double-submit lets exactly one caller through (the loser gets the same generic `VALIDATION`) and a mid-flight failure rolls the claim back. `passwordResets` joined the UoW `Repositories` bundle (the slice-13 `invoices` precedent: port bundle · in-memory context · `PrismaUnitOfWork` · in-memory wiring factory). | `packages/application/src/{ports/repositories.ts,ports/unit-of-work.ts,use-cases/password-reset.ts,testing/in-memory.ts}` · `apps/api/src/persistence/{prisma/prisma-repositories.ts,prisma/prisma-unit-of-work.ts,persistence.module.ts}` · `apps/api/src/auth/auth.module.ts` |
| 5 | Timing-safe forgot-password | The unknown/DISABLED path performs the SAME token generate+hash work (discarded); email dispatch is fire-and-forget (`void send().catch(() => {})` — failures deliberately unlogged: a delivery log line would carry the address, enumeration-safety > delivery observability). `StubEmail` records synchronously on call, so the recovery BDD/e2e mail assertions stay green unchanged. | `packages/application/src/use-cases/password-reset.ts` |
| 2 | multer override | `overrides: multer: '>=2.2.0'` in `pnpm-workspace.yaml` (pnpm 11 honors workspace-file overrides). `@nestjs/platform-express` pinned 2.1.1 → GHSA-72gw-mp4g-v24j (high) + aborted-upload DoS (moderate). `pnpm why multer` → single `multer@2.2.0`; `pnpm audit` no longer reports multer. | `pnpm-workspace.yaml` · `pnpm-lock.yaml` |
| 8 | pgvector HNSW index | The old `ORDER BY embedding <=> $q, id` tie-break forced a full sort — an HNSW index would never be used. `search`/`searchScoped` now nest an inner ANN scan (bare-distance ORDER BY, `LIMIT k*4` oversample, filters inside) under an outer deterministic re-sort (`distance, id`) `LIMIT k` — identical result semantics (the int tests' deterministic ties are preserved). Migration `20260706180914_knowledge_hnsw_index` creates `knowledge_chunks_embedding_hnsw_idx` (`hnsw`, `vector_cosine_ops`; 1024 dims < the 2000 cap; `pgvector/pgvector:pg16` ≥ 0.5). | `apps/api/src/persistence/prisma/prisma-repositories.ts` · `apps/api/prisma/migrations/20260706180914_knowledge_hnsw_index/` |
| 11 | AuthHero rAF pause | The helix loop pauses while `document.hidden` (visibilitychange; resumes on visible) and renders ONE static frame with no loop under `prefers-reduced-motion: reduce`; unmount removes the listener and cancels the pending frame. | `apps/web/src/screens/AuthHero.tsx` |
| 12 | EventSource credentials | Chat live stream opens with `{ withCredentials: true }` so the httpOnly session cookie rides a cross-origin SPA→API deployment (no-op behind the same-origin vite proxy). | `apps/web/src/screens/ChatScreen.tsx` |

## Pending owner decision (surfaced, NOT auto-started)

3. **Rate-limit fail-open policy** (`rate-limit.guard.ts:61`). Today: if Redis is unreachable the
   guard fails *open* (no throttling) to protect availability. Sharp edge: an outage disables auth
   throttling. **Proposal:** keep fail-open globally but, for auth paths, degrade to a process-local
   in-memory bucket for the blip (availability *and* a floor of protection) rather than silently
   unthrottled. Needs a yes/no.

4. ~~**Per-IP global bound + backoff/lockout**~~ — ✅ **DONE (slice 39, programa v8, 2026-07-10, on `main`)**
   + **tuned 2026-07-12**. New `AuthAbuseGuard` (sibling of `RateLimitGuard`): a per-IP request ceiling
   (org-farming) + an exponential-backoff lockout after N failed credential attempts (stuffing), both keyed on
   client IP (never per-account → no victim DoS), fail-open, fed by a global `LoginOutcomeInterceptor` + a
   Redis/in-mem `LoginAttemptStore`. **Tuning (2026-07-12, `f6ebf78`):** the A1 ceiling now excludes `/auth/login`
   (NAT-hostile on successful logins; login stays covered by the A2 failure lockout) and a weak-new-password DTO
   rejection on reset-password no longer feeds the lockout (dedicated `RESET_TOKEN_INVALID` code isolates a real
   bad token from a fumble). See CLAUDE.md "Programa paralelo v8" + "Programa v8 tuning + staging redeploy".

5. **Pagination** (`prisma-repositories.ts` list methods). Keyset pagination on
   features/testCases/runs changes the **list response shape** → ripples to the web client + BDD +
   Playwright. This is a **slice with a spec**, not an in-loop tweak. Impact is low at current volume.

9. **Knowledge/RAG final posture** (`schema.prisma:432`). Schema is GLOBAL shared (decision S5-A) but
   the data-model contract still carries a tenant-scoped design. If global is final → document
   invariants + permitted corpus + "no private data in the shared KB". If private RAG is coming →
   separate tables/indexes *now*. Needs the owner to pick the end state.

- **CSP / security headers for the SPA.** Helmet hardens the API, but the main XSS surface is the
  web app, served by the static host/CDN — which has no config in this repo. **Infra/deploy task**,
  outside the code loop; flag for the hosting setup.
- **Pin GitHub Actions to SHA.** `ci.yml`/`codeql.yml`/`secret-scan.yml` mix `@v4` tags with SHAs.
  Correct SHAs must be resolved (`gh api .../git/ref/tags/v4`), not guessed. Low value, mechanical —
  do as a standalone pass when convenient.
