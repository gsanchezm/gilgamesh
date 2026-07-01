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

## Pending owner decision (surfaced, NOT auto-started)

3. **Rate-limit fail-open policy** (`rate-limit.guard.ts:61`). Today: if Redis is unreachable the
   guard fails *open* (no throttling) to protect availability. Sharp edge: an outage disables auth
   throttling. **Proposal:** keep fail-open globally but, for auth paths, degrade to a process-local
   in-memory bucket for the blip (availability *and* a floor of protection) rather than silently
   unthrottled. Needs a yes/no.

4. **Per-IP global bound + backoff/lockout** (`rate-limit.guard.ts:26`, currently deferred §10.2).
   Real defense vs credential-stuffing / org-farming. This is a **security feature with its own spec**
   (SDD→BDD→TDD), not a refactor — recommend promoting from "deferred" to a near-term slice.

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
