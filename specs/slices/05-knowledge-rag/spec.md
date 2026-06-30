# Slice 5 — Knowledge / RAG (global shared knowledge base) (SDD Spec)

> Spec-Driven-Design spec for the fifth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) → **Prototype extract**.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone.
> v0.1 — 2026-06-30. Status: DRAFT — building SDD→BDD→TDD on branch `slice-5-knowledge-rag`.

---

## 0. Owner decisions S5

Owner picked **Knowledge / RAG** as slice 5 and answered the corpus-analysis questions:
- **S5-A — Global shared KB.** Ingest the `rag/` corpus (24 QA docs — ISTQB syllabi + BDD books, pre-chunked
  into `rag/chunks/chunks.jsonl`, 2,647 chunks) as a **GLOBAL, shared** knowledge base that grounds **all**
  orgs' generation. This deliberately lives **OUTSIDE** the per-`orgId` tenant-isolation boundary (the inverse
  of every other query). Per-org private `KnowledgeDoc` uploads (keystone model) are a fast-follow.
- **S5-B — Deterministic stub embeddings.** Embed via `AgentBrainPort.embed`, implemented as a deterministic,
  offline **lexical-hash** embedder (bag-of-words → 1536-dim, L2-normalized) — distinct texts → distinct
  vectors → real *lexical* similarity (not semantic). Real semantic embeddings land with the Brain slice.
- **S5-C — Wire the grounding seam now.** A `KnowledgeRetrievalPort` that `GenerateDrafts` consults
  (retrieve top-k → into the brain prompt + citations on the output). With stub brain+embed the grounding is
  demonstrable but not yet "intelligent".
- **S5-D — Licensing sign-off.** Internal **retrieval-grounding** of the copyrighted corpus (ISTQB syllabi +
  commercial BDD books) is approved: the model reads chunks to reason; every chunk carries **source +
  section citations** that flow to the output; the embedding store is **private/non-redistributable**;
  verbatim text is never re-published without attribution. (Recorded in the decisions log.)

---

## 1. Feature intent

Give the platform a **shared QA knowledge base** so the AI agents author tests **grounded in established
methodology** (ISTQB + BDD) rather than from thin air. The `rag/` corpus is **ingested** (scrubbed → embedded →
stored in pgvector), **searchable** (semantic-ish retrieval with citations), and **wired into generation**
(`GenerateDrafts` retrieves relevant chunks + cites them). The KB is **global** — one shared collection seeding
every org's agents — distinct from (future) per-org private uploads.

---

## 2. Scope

### In scope
- **`KnowledgeChunk` store (shared)** — keystone `KnowledgeChunk` (content + `embedding vector(1536)`) but at
  **global scope** (no `orgId`; a shared collection). pgvector column + cosine similarity.
- **Ingest** — `IngestKnowledge`: take corpus chunks (id, source, headingPath, section, text), **scrub**
  page-furniture (`Page N of M`, `© … ISTQB …` running headers/footers) + normalize `<br>` + drop tiny
  boilerplate (< ~16 tokens), **embed** (stub), and **upsert** into the shared store. Driven by a seed that
  reads `rag/chunks/chunks.jsonl`.
- **Deterministic lexical-hash embedder** — `AgentBrainPort.embed` now returns text-dependent 1536-dim
  L2-normalized vectors (a pure `embedText` in the domain); cosine ranks by lexical overlap.
- **Search** — `SearchKnowledge`: embed a query → cosine **top-k** over the shared store → results with
  **citations** (source title + `headingPath`/section). `GET /knowledge/search?q=…&k=…` (authenticated).
- **Grounding seam** — `KnowledgeRetrievalPort` consumed by `GenerateDrafts`: retrieve top-k for the prompt →
  pass the chunk texts into the brain context → attach the citations to the generated `GeneratedDraftsView`.
- **web** — a Knowledge search screen (`/knowledge`): query → ranked snippets + source citations; generated
  drafts surface their grounding citations.
- Cross-cutting: the store is **global** (not `orgId`-scoped) but search requires **authentication**; audit on
  search/ingest; RFC9457 errors; both persistence wirings; CSRF n/a (search is a GET).

### Out of scope (explicitly deferred)
- **Per-org private `KnowledgeDoc` uploads** (keystone per-`orgId` upload + `ArtifactStorage`/MinIO blob +
  `KnowledgeDocStatus` INDEXING pipeline) — fast-follow (the retrieval is built so a tenant union slots in).
- **Real semantic embeddings** — the deterministic lexical-hash stub only (Brain slice supplies real).
- **A document chunker** — the corpus is pre-chunked; chunking uploaded docs is the per-org follow-up.
- **Figures/diagrams, table reconstruction, code-block re-fencing** — the corpus' lost images + mangled
  Gherkin are accepted limitations (citations note the source for a human to consult).
- **Advanced retrieval** (MMR/diversity, per-source caps, intent routing) — basic cosine top-k now; the
  governance-prose over-representation risk is noted, not solved.

---

## 3. Actors / personas

| Actor | Slice-5 capabilities |
|-------|----------------------|
| **Any authenticated user** | Search the shared KB; see grounded generation + citations. |
| **System / deploy** | Ingest the `rag/` corpus into the shared KB (seed). |
| **Unauthenticated** | `/knowledge/*` → `401`. |

The shared KB is **global** — there is no per-`orgId` scoping on the shared chunks (S5-A); authentication is
still required to query.

---

## 4. Domain model (keystone names verbatim)

- **`KnowledgeChunk`** (keystone) — slice-5 shared fields: `id, source(string), headingPath(string[]),
  section(string), content(text), embedding(number[1536]), tokenEstimate(int)`. **No `orgId`** (shared). The
  keystone per-doc `KnowledgeDoc` + `orgId`/`docId` land with the per-org follow-up.
- **`KnowledgeDocStatus`** = `UPLOADED | INDEXING | INDEXED | FAILED` (keystone) — used by the deferred upload
  pipeline; the seed ingest writes chunks directly.
- Pure domain: `scrubChunk(text)` (strip furniture, normalize `<br>`), `embedText(text, dim=1536)`
  (deterministic lexical-hash, L2-normalized), `cosineSimilarity(a, b)`.

### Ports (`@gilgamesh/application`)
- `AgentBrainPort.embed(texts) -> number[][]` (keystone §5) — now the deterministic lexical-hash embedder.
- `KnowledgeChunkRepository` — `upsertMany(chunks)`, `search(queryEmbedding, k) -> ScoredChunk[]`, `count()`.
- `KnowledgeRetrievalPort` — `retrieve(query, k) -> { chunk, citation }[]`, consumed by `GenerateDrafts`.

---

## 5. API (keystone §6)

| Method · Path | Use case | Auth |
|---|---|---|
| `GET /knowledge/search?q=&k=` | `SearchKnowledge` (top-k chunks + citations) | authenticated |
| `GET /knowledge/stats` | chunk count + sources (KB health) | authenticated |

`POST/GET/DELETE /projects/{id}/knowledge` (keystone per-org upload) is the deferred follow-up. Errors via
`DomainExceptionFilter` → RFC9457.

---

## 6. Acceptance criteria

- **AC-KB-01** — Ingesting corpus chunks scrubs page-furniture + normalizes `<br>` + drops tiny boilerplate,
  embeds, and stores them in the **shared** (non-`orgId`) KB.
- **AC-KB-02** — `scrubChunk` removes `Page N of M` / `© … ISTQB …` running headers/footers from chunk text.
- **AC-KB-03** — `embedText` is deterministic + text-dependent: distinct texts → distinct 1536-dim
  L2-normalized vectors; identical text → identical vector.
- **AC-KB-04** — `SearchKnowledge` returns the top-k chunks by cosine similarity to the query, **lexically
  relevant** (a query's terms surface chunks containing them), each with a citation (source + section).
- **AC-KB-05** — Determinism: the same query → the same ranked results.
- **AC-KB-06** — The KB is **global**: two different orgs' users searching the same query get the same shared
  results (no tenant scoping on the shared chunks).
- **AC-KB-07** — `GenerateDrafts` retrieves top-k chunks for the prompt, passes them into the brain context,
  and attaches their **citations** to the returned drafts.
- **AC-KB-08** — `GET /knowledge/search` requires authentication (`401` otherwise) and returns chunks +
  citations + scores.
- **AC-KB-09** — Citations carry the source document title + `headingPath`/section so generated artifacts are
  traceable (licensing).
- **AC-KB-10** — The embedding is stored in a pgvector `vector(1536)` column; cosine search works against
  real Postgres (`test:int`) and the in-memory wiring identically.

---

## 7. Non-functional

- **Shared-vs-tenant** — the shared KB intentionally has **no `orgId`**; retrieval is global. This is the one
  place the tenant-isolation rule is relaxed (S5-A) — the search endpoint still requires auth, and the design
  leaves a clean seam to **union** a future per-org collection without leaking across tenants.
- **Clean Architecture** — use cases depend only on ports (`KnowledgeChunkRepository`, `AgentBrainPort`,
  `KnowledgeRetrievalPort`, `Clock`, `IdGenerator`); pgvector + Prisma adapters wired in `apps/api`. Domain
  (`scrubChunk`/`embedText`/`cosineSimilarity`) stays framework-free (fitness-test guarded).
- **Determinism/reproducibility** — the stub embedder is pure/offline; identical inputs → identical vectors +
  ranking, so search + grounding are testable without a network/model.
- **Licensing (S5-D)** — retrieval-grounding only; citations always carry source+section; the embedding store
  is private/non-redistributable; no verbatim re-publication without attribution.
- **Security** — `/knowledge/*` requires authentication; OWASP ASVS L2; no secrets.
