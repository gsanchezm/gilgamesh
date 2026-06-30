# Audit follow-up — tracking (living)

Triage + execution status of the codebase audit (10 enhancements + 5 refactors). Branch:
`refactor/audit-hardening`. Updated as work lands. Items needing the owner's call are in
**§ Pending owner decision** — they change behavior/contracts or are infra, so they are *not*
auto-started inside the loop.

## Done — Batch A (safe, contract-stable) ✅ committed, fully verified

| # | Item | What landed |
|---|------|-------------|
| 1 | Bound auth inputs | `@MaxLength` on Register/Login DTOs (email/names/password), driven from `INPUT_LIMITS`. Rejected before argon2 cost. |
| 2 | Deterministic body limit | `configureBodyParser()` → 512 KiB JSON/urlencoded (> 256 KiB `feature.content`), same source as DTOs; wired in `main.ts`. Filter now preserves body-parser 413/400 (was masked as 500). |
| 8 | In-memory ↔ Prisma order parity | In-memory adapters sort like Prisma (features `createdAt,id` asc · test cases `key` asc · runs `createdAt,id` desc). |
| R | Centralize constants | `common/input-limits.ts` + `auth/cookie-names.ts` (cookie names were duplicated ×3). |

Verification: typecheck + lint clean · api 83 + application 138 Docker-free · `test:int` 14 ·
BDD 94 scenarios / 739 steps (Postgres + Redis).

## Planned — Batch B (contained correctness / perf, safe to do in-loop)

| # | Item | Approach |
|---|------|----------|
| 7 | Deterministic TC-key under concurrency | Retry-on-`P2002` (the unique constraint is already the source of truth) rather than a counter table. Only reproduces against real Postgres → verify with `test:int`. |
| 6 | N+1 in `ListFeatures` | New repo method (e.g. `countScenariosByFeature`) on `ScenarioRepository`; one aggregate query instead of per-feature. Port change → both adapters + fitness tests. Low urgency at current scale. |
| 10 | Batch RAG ingest | `upsertMany` → single multi-row `INSERT … ON CONFLICT` (or chunked) instead of one round-trip per chunk. Raw SQL → verify with `test:int` (pgvector). |

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
