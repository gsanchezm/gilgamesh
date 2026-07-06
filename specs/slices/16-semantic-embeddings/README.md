# Slice 16 — Semantic embeddings (Voyage) (SDD Spec)

> Spec-Driven-Design spec for the sixteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.5** — this slice
> executes the v0.5 owner-approved BREAKING amendment: `KnowledgeChunk.embedding` vector(1536)→vector(1024)
> for Voyage `voyage-4` semantic embeddings; destructive vector migration + full corpus re-ingest).
> v0.1 — 2026-07-06. Status: IN PROGRESS on branch `feat-semantic-embeddings`.
> Scope: real semantic embeddings behind the frozen `AgentBrainPort.embed` seam + EMBED metering
> (closes the S9-2 deferral: "Anthropic has no embeddings API — Voyage decision").

---

## 0. Owner decisions S16 (approved 2026-07-06, keystone v0.5)

1. **Provider** — Voyage AI, model **`voyage-4`** (32K context), platform env key **`VOYAGE_API_KEY`**.
   Voyage distinguishes `input_type` **`query`** (retrieval questions) vs **`document`** (stored corpus).
2. **Dimension** — **1024** (`voyage-4` default; Voyage 4 has **no 1536 option**). BREAKING for the stored
   vectors: `KnowledgeChunk.embedding` becomes `vector(1024)` via a **destructive** migration (§9); the
   deterministic offline lexical-hash embedder emits 1024 dims so offline and real vectors share one column.
3. **BYOK for Voyage is OUT OF SCOPE** — no `voyage` key in the §8 integration catalog yet (later keystone
   amendment). The platform key only; org-BYOK stays Anthropic-only (S9).
4. **Offline/CI posture unchanged** — `BRAIN_MODE=offline` (all four harnesses + CI) keeps embeddings on the
   deterministic FNV-1a lexical hash; **no suite ever calls the network**. Real semantic embeddings require
   only `VOYAGE_API_KEY` at runtime.
5. **EMBED metering turns on** — the `BrainSurface` value `EMBED` (reserved-but-unwritten since S9) now
   writes `BrainUsage` rows for org-attributable embed calls (§6).

---

## 1. Feature intent

Swap the lexical-hash stand-in for **real semantic embeddings** behind the frozen `AgentBrainPort.embed`
seam — same port, no new port — so knowledge search and RAG grounding rank by *meaning* when a Voyage key is
present, while every offline path (CI, BDD, dev without a key) keeps the deterministic lexical stub at the
same 1024 dimension. Every org-attributable embedding call is now **metered** into `BrainUsage`
(surface `EMBED`) and visible in the existing usage view.

## 2. Scope

### In scope
- **domain** — `EMBED_DIM` 1536→1024 (`embedText` stays pure/deterministic, L2-norm unchanged).
- **application** — optional **`embedAs(texts, kind)`** port extension (§5) + EMBED metering threaded
  through the knowledge pipeline (`IngestKnowledge`, `SearchKnowledge`, `KnowledgeRetriever`,
  `UploadKnowledgeDocument`); `DeterministicBrain.embedAs` (lexical, deterministic token estimate).
- **api infra** — `VoyageBrainEmbedder` (fetch to `https://api.voyageai.com/v1/embeddings`, model
  `voyage-4`, explicit `output_dimension: 1024`, batched inputs, 30s timeout + ONE retry on 429/5xx —
  the ClaudeBrain pattern; the key NEVER in logs/errors/rows). `SelectingBrain`/`brainFromEnv` route
  `embed`/`embedAs` to Voyage when `VOYAGE_API_KEY` is set AND `BRAIN_MODE != offline`, else lexical.
- **api persistence** — `KnowledgeChunk.embedding` → `Unsupported("vector(1024)")` + the destructive
  migration `embedding_vector_1024` (§9); `scripts/ingest-corpus.mjs` re-ingests at 1024 and gains an
  optional real-Voyage mode.
- **SearchKnowledge attribution** — `GET /knowledge/search` attributes its query-embed cost to the
  caller's org (first membership) for metering; the search itself stays global/org-agnostic (S5-A).

### Out of scope (explicitly deferred)
- **Voyage BYOK** (`voyage` §8 key + vault flow) — later keystone amendment (owner decision S16-3).
- **Automatic corpus re-ingest inside the migration** — re-ingest is operational (§9).
- **Reranking, hybrid lexical+semantic retrieval, recall@k evaluation** — later RAG-quality slice.
- **Token charging** — `BrainUsage` billing hookup stays with the 4-tier billing migration.

## 3. Contracts (keystone v0.5, verbatim)

- **`AgentBrainPort.embed(texts: string[]): Promise<number[][]>`** — FROZEN; the only embedding seam.
  No new port. The `input_type` distinction rides an **optional extension interface** (§5), the
  `streamWithUsage`/`forOrg` precedent from S9 (spec 09 §13).
- **`KnowledgeChunk.embedding`** — `vector(1024)` (v0.5, was 1536). pgvector, `Unsupported` in Prisma,
  raw-SQL `::vector` upsert + `<=>` cosine search (unchanged shape).
- **`BrainUsage`** — id, orgId (**non-null, frozen**), tier:BrainTier, surface:BrainSurface (`EMBED`),
  inputTokens, outputTokens, cacheReadTokens=0, cacheCreateTokens=0, createdAt.
- **Routes** — unchanged. `GET /knowledge/search` and `GET /orgs/{orgId}/brain/usage` keep their shapes.

## 4. Acceptance criteria

- **AC-EMB-01 (dimension end-to-end)** — `EMBED_DIM = 1024`: `embedText` returns 1024-dim L2-normalized
  vectors; the pgvector column is `vector(1024)`; every stored chunk embedding has 1024 dimensions in both
  wirings (in-memory cosine + pgvector `<=>`).
- **AC-EMB-02 (offline behavior preserved)** — with `BRAIN_MODE=offline` (or no `VOYAGE_API_KEY`):
  embeddings are the deterministic lexical hash at 1024 dims; knowledge search still returns ranked results
  with source citations (slice-5 AC-KB-04/05/09 regression-safe); no network call leaves the process.
- **AC-EMB-03 (real adapter)** — with `VOYAGE_API_KEY` set AND `BRAIN_MODE != offline`:
  `embed`/`embedAs` call Voyage `voyage-4` with `input_type` `document` (default) or `query`,
  `output_dimension: 1024`, `Authorization: Bearer` header; inputs are batched; 30s timeout + ONE retry on
  429/5xx; a non-2xx surfaces status-only errors; the key never appears in any log, error, or row.
- **AC-EMB-04 (kind threading)** — `SearchKnowledge` and `KnowledgeRetriever` grounding embed the query
  with kind `query`; `IngestKnowledge` and `UploadKnowledgeDocument` embed content with kind `document`.
  Adapters WITHOUT the extension keep working through the frozen `embed()` (feature detection, default
  `document`).
- **AC-EMB-05 (EMBED metering)** — each org-attributable embed call appends ONE `BrainUsage` row:
  surface `EMBED`, tier `HAIKU` (§6), `inputTokens` = total embedding tokens, `outputTokens` = 0.
  Attributable calls: per-org document upload, org-scoped grounding (chat + generate), and global search
  (attributed to the caller's org). A metering failure NEVER breaks ingest/search/grounding.
- **AC-EMB-06 (unmetered platform ingest)** — global corpus ingest (the `KnowledgeSeeder`,
  `ingest:corpus`) writes NO usage rows: `BrainUsage.orgId` is frozen non-null and there is no tenant to
  attribute (documented posture, revisited if a platform-org concept lands).
- **AC-EMB-07 (destructive migration + re-ingest)** — the migration deletes all `knowledge_chunks` AND
  `knowledge_documents` (a document whose chunks were destroyed must not linger with a stale `chunkCount`),
  then `ALTER COLUMN embedding TYPE vector(1024)`. Re-ingest is required and documented (§9).
- **AC-EMB-08 (licensing posture unchanged, S5-D)** — retrieval-grounding only; citations always carry
  source+section; the store stays private/non-redistributable. Changing the embedding provider changes
  NOTHING about content licensing.

## 5. The `embedAs` optional extension (design)

```ts
// packages/application/src/ports/brain.ts (S16 — the streamWithUsage/forOrg precedent)
export type EmbeddingKind = 'query' | 'document';
export interface EmbedWithUsageResult {
  embeddings: number[][];
  usage: { totalTokens: number }; // Voyage usage.total_tokens; whitespace-token estimate for the stub
}
export interface KindAwareEmbeddingBrain {
  embedAs(texts: string[], kind: EmbeddingKind): Promise<EmbedWithUsageResult>;
}
export function hasEmbedAs(brain: AgentBrainPort): brain is AgentBrainPort & KindAwareEmbeddingBrain;
```

- The knowledge pipeline feature-detects `hasEmbedAs`; a bare `AgentBrainPort` falls back to the frozen
  `embed()` (kind lost → Voyage-default `document` semantics; usage unknown → `totalTokens 0`).
- `DeterministicBrain.embedAs` = lexical vectors + `totalTokens` = deterministic whitespace-token count
  (`/\S+/g`), so offline usage rows still carry meaningful counts.
- `SelectingBrain` implements the extension: Voyage when configured, else the stub. `forOrg(orgId)` handles
  delegate `embed`/`embedAs` to the PLATFORM selection (Voyage BYOK is out of scope — embeddings are
  provider-independent of an org's Anthropic BYOK key).
- Folded into the port at the next keystone major.

## 6. EMBED metering shape (decision)

- **One `BrainUsage` row per embed call** (a batch = one call = one row), the S9 "one row per brain call"
  rule.
- **surface** `EMBED`; **tier** `HAIKU` — `BrainTier` is frozen and has no embedding member; `HAIKU` is the
  nominal lightest tier, the ROUTER-at-HAIKU precedent. Revisited if the keystone ever grows an EMBED tier.
- **inputTokens** = the provider-counted total (`usage.total_tokens` from Voyage; the stub's whitespace
  estimate); **outputTokens** = 0 (embeddings produce no completion tokens); cache fields 0.
- **Attribution** requires an orgId (frozen non-null): upload → `input.orgId`; scoped grounding →
  `filter.orgId`; global search → the caller's first membership org (controller-resolved). Platform-global
  ingest and the org-less `KnowledgeRetriever.retrieve` are unmetered (AC-EMB-06).
- **Resilience**: the append is wrapped — a metering failure is swallowed and never fails the user call.

## 7. Env vars

| Var | Meaning | Default |
|-----|---------|---------|
| `VOYAGE_API_KEY` | Platform Voyage key; enables real embeddings when `BRAIN_MODE != offline` | unset → lexical |
| `VOYAGE_MODEL` | Voyage model override | `voyage-4` |
| `BRAIN_MODE=offline` | Forces lexical embeddings (and the stub brain) regardless of keys | harness/CI default |

## 8. Test strategy

- **BDD (offline)** — `embeddings.feature` (§10): search still ranked+cited on 1024 lexical vectors; the
  stored column really holds 1024-dim vectors (`vector_dims`); EMBED usage rows appear for search, upload
  and chat grounding; the usage view aggregates surface `EMBED`; embeddings self-report lexical offline.
- **TDD Docker-free** — domain dim tests; stub `embedAs` determinism+estimate; use-case metering (kind
  threading, resilience, org attribution, no-org no-op); `VoyageBrainEmbedder` against a stubbed `fetch`
  (wire shape, batching, retry/timeout, key hygiene); `SelectingBrain` routing + `brainFromEnv` selection.
- **Integration (orchestrator-run)** — the existing pgvector `*.int.test.ts` suite now exercises the 1024
  column via the new migration; no scenario change expected.

## 9. Destructive migration + re-ingest runbook (AC-EMB-07)

Migration `apps/api/prisma/migrations/20260706150000_embedding_vector_1024/`:
1. `DELETE FROM knowledge_chunks` — 1536-dim vectors cannot be cast to 1024; all stored embeddings are
   destroyed (global corpus + per-org uploads).
2. `DELETE FROM knowledge_documents` — per-org document rows whose chunks were destroyed are removed too
   (otherwise they would report a stale `chunkCount` over zero chunks). Owners re-upload documents.
3. `ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(1024);`

**Re-ingest afterwards (required):**
- The `KnowledgeSeeder` re-seeds the paraphrased sample corpus automatically at next boot (empty-KB check).
- `pnpm --filter @gilgamesh/api ingest:corpus` re-loads the full `rag/` corpus (~2,647 chunks) — lexical by
  default; with `VOYAGE_API_KEY` set (and `BRAIN_MODE != offline`) it embeds via Voyage `voyage-4`.
- Per-org uploaded documents must be re-uploaded by their orgs (their embeddings cannot be regenerated
  server-side: original file content is not retained, only chunks).
- Mixed stores are impossible by construction: the column enforces 1024, and both the lexical and Voyage
  paths emit 1024.

## 10. BDD feature files

- `embeddings.feature` — 6 scenarios: offline ranked+cited search at 1024 dims · stored-vector dimension ·
  EMBED row on search · EMBED row on document upload · EMBED row on chat grounding · usage view aggregates
  EMBED. (Real-Voyage behavior is unit-tested against a stubbed fetch — never in the BDD sweep.)
