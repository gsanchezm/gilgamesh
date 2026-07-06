# Slice 19 — Voyage BYOK (per-org Voyage embedding key) (SDD Spec)

> Spec-Driven-Design spec for the nineteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.6** — this slice
> consumes the v0.6 amendment: `voyage` integration key, §8 group `AI_PROVIDERS`).
> v0.2 — 2026-07-06 (adds the **coherence gate**, owner decision after adversarial review; v0.1 same day).
> Status: IN PROGRESS on branch `feat-voyage-byok`.
> Scope: per-org Voyage API key via the S6 integration flow (the S9 anthropic-BYOK pattern, applied to
> the S16 embedding provider). Closes the S16-3 deferral ("Voyage BYOK — later keystone amendment").

---

## 0. Owner decisions S19 (keystone v0.6, 2026-07-06)

1. **Catalog** — `voyage` joins the §8 `AI_PROVIDERS` integration keys next to `anthropic`. Display name
   "Voyage AI". Same Integration machinery: verified, vaulted as a `secretRef`, raw key discarded.
2. **Verification** — a `VoyageKeyVerifier` makes ONE minimal embed ping (1 input, the S16
   `VoyageBrainEmbedder` wire shape) with the CANDIDATE key. Explicit `BRAIN_MODE=offline` skips
   verification (the stub verifier, harness/CI default). A rejected key (non-retryable 4xx) →
   `VALIDATION`, nothing stored; a provider outage (timeout/5xx/429 after retry) propagates — it must
   never silently accept a bad key (the S9 `AnthropicKeyVerifier` rule).
3. **Call-time resolution** — org-attributable embeddings resolve the org's `voyage` key at CALL TIME,
   mirroring the S9 `forOrg(orgId)` pattern: per-call Integration row re-read (disconnect/rotation bite
   on the very next call) + an orgId+secretRef LRU-ish instance cache. Resolution per call **when the
   coherence gate (decision 6) is open**: org `voyage` key → platform `VOYAGE_API_KEY` env.
4. **Offline seam unchanged** — `BRAIN_MODE=offline` (all four harnesses + CI + api test-setup default)
   pins the lexical embedder AND the stub verifier; no suite ever calls the network. The verifier is
   gated only on the explicit offline pin (a voyage key can be verified for real even on a deployment
   without a platform `VOYAGE_API_KEY` — the key is stored ready; see decision 6 for when it is USED).
5. **No keystone change** — `voyage` is already frozen in §8 (v0.6). No new entities, routes, or ports;
   the frozen `BrainKeyVerifier.verify({key, token})` already carries the provider key to dispatch on.
6. **The COHERENCE GATE (owner decision, 2026-07-06 — remedy for the adversarial-review blocking
   finding)** — an org's voyage key is used for embeddings ONLY when the platform embedding space is
   already Voyage (platform `VOYAGE_API_KEY` present, not forced offline): same `voyage-4` model, same
   1024-dim space — the org key then merely substitutes billing/attribution for that org's embed calls.
   **When the platform has no voyage key, the space is lexical FNV-1a**: the global corpus and every
   pre-connect document are lexical vectors, so embedding an org's queries with `voyage-4` would make
   every cross-space cosine garbage — connecting a key would silently DEGRADE that org's
   search/grounding. Therefore: connect/verify/store work identically (the key sits vaulted, ready),
   but ALL embedding paths stay on the platform's lexical space; the org key is never used to embed
   queries or documents. **Long-term fix (future slice):** per-chunk embedding provenance (model+dim
   recorded per row) + re-embed-on-connect — also the prerequisite for ANY embedding-model upgrade.

---

## 1. Feature intent

Let an org bring its own Voyage API key exactly like a repo or anthropic integration — verified once,
stored only as a vault `secretRef`, raw key discarded — so that, **on a platform whose embedding space is
already Voyage**, that org's knowledge search, document upload, and chat/generate grounding embed with
**its** key at call time (billing/attribution substitution within the same `voyage-4` space), falling back
to the platform key. On a lexical platform (no `VOYAGE_API_KEY`) the key is stored ready but never used to
embed — the coherence gate (decision 6). All offline/CI behavior is unchanged.

## 2. Scope

### In scope
- **domain** — `voyage` in `AI_PROVIDER_CATALOG` (`AiProviderKey = 'anthropic' | 'voyage'`).
- **application** — no new use cases: `ListIntegrations`/`ConnectIntegration`/`DisconnectIntegration`
  cover `voyage` via the derived catalog (S6/S9 flow untouched). The knowledge pipeline
  (`SearchKnowledge`, `KnowledgeRetriever.retrieveScoped`, `IngestKnowledge` with attribution,
  `UploadKnowledgeDocument`) now resolves its embedding brain through the OPTIONAL `forOrg(orgId)`
  extension when an org is in scope (`embeddingBrainFor` helper; adapters without the extension keep
  the direct path — in-memory tests unchanged).
- **api infra** — `VoyageKeyVerifier` (ONE minimal embed ping, decision S19-2);
  `brainKeyVerifierFromEnv` becomes key-routing (`voyage` → Voyage ping, else the S9 anthropic path);
  `SelectingBrain` gains org-voyage call-time resolution behind the existing `forOrg` handle
  (`OrgKeyResolution.makeVoyage` factory + a second LRU cache, decision S19-3), **behind the coherence
  gate** (decision S19-6): `brainFromEnv` wires the voyage factory only when the platform embedder is
  Voyage, and `forOrg` additionally requires the platform Voyage embedder before the org-key path opens.
- **web** — the Integrations screen is data-driven from the server catalog; the voyage tile appears,
  connects, and disconnects with zero new wiring (covered by a unit assertion).

### Out of scope (explicitly deferred)
- Per-org Voyage **model** override (config json) — the org key uses the platform `VOYAGE_MODEL`.
- **Per-chunk embedding provenance + re-embed-on-connect** — the long-term fix behind the coherence
  gate (decision 6): today nothing records WHICH model/space produced a stored vector, so space
  coherence can only be guaranteed by construction. Inside the gate that construction holds — the
  org-key path opens only when the platform space is already `voyage-4` at 1024, so every writer
  (platform or org key) emits into the same space. Outside it (lexical platform) the org key is
  simply not used. Recording provenance per chunk and re-embedding on connect (or on any
  embedding-model upgrade — same machinery) is a future slice.
- Anthropic-style BYOK usage attribution changes — EMBED metering (S16) is unchanged.
- A real Key Vault adapter — `StubSecretVault` stays (audit-v2 follow-up, production-BYOK prerequisite).

## 3. Contracts (keystone v0.6, verbatim)

- **`Integration`** — the BYOK row: `key='voyage'`, `group=AI_PROVIDERS`, `secretRef`(NEVER raw token),
  `connected`, Unique(orgId,key). Mutated only via `PATCH /orgs/{orgId}/integrations/voyage`.
- **`AgentBrainPort.embed/embedAs`** — the only embedding seams (S16). No new port; org resolution rides
  the OPTIONAL S9 `forOrg` extension.
- **`SecretVault.put/get`** — S6/S9 shape unchanged.
- **Routes** — unchanged (`GET /orgs/{orgId}/integrations`, `PATCH /orgs/{orgId}/integrations/{key}`).

## 4. Acceptance criteria

- **AC-VBYOK-01 (catalog)** — `voyage` appears in the integrations catalog under `AI_PROVIDERS`,
  disconnected by default; the web Integrations screen renders its tile from the catalog.
- **AC-VBYOK-02 (connect discards the key)** — connect verifies the candidate key, stores ONLY a
  synthetic `secretRef`, and discards the raw key: it never appears in any DB row, View, list response,
  audit metadata, log, or error (S6-B assertion re-applied). An invalid key → `VALIDATION` (422),
  nothing stored.
- **AC-VBYOK-03 (disconnect + RBAC)** — disconnect clears `connected` + `secretRef`; OWNER/ADMIN gate
  (MEMBER → 403, non-member → 404); connect/disconnect audited without secrets.
- **AC-VBYOK-04 (offline seam intact)** — with `BRAIN_MODE=offline`: the stub verifier serves connects,
  embeddings stay the deterministic lexical hash even when a `voyage` row is connected, and no network
  call leaves the process in any suite.
- **AC-VBYOK-05 (call-time resolution, inside the gate)** — with the coherence gate open (platform
  `VOYAGE_API_KEY` present, not offline): every org-attributable embed (knowledge search, document
  upload, scoped chat/generate grounding) resolves the org's `voyage` Integration row per call —
  org key → platform `VOYAGE_API_KEY`; the per-org embedder is cached by orgId+secretRef (LRU-ish,
  shared cap) so a disconnect or key rotation takes effect on the very next call; the resolved key is
  never logged, thrown, or persisted.
- **AC-VBYOK-06 (verification ping)** — `VoyageKeyVerifier` makes ONE minimal embed request with the
  candidate key; non-retryable 4xx (except 408/429) → `VALIDATION`; timeout/429/5xx propagate (an
  outage never silently accepts a key); a blank key is rejected locally without any network call.
- **AC-VBYOK-07 (the coherence gate)** — on a platform WITHOUT `VOYAGE_API_KEY` (lexical space):
  connect/verify/store behave exactly as AC-VBYOK-02/03/06 (the key sits vaulted, ready), but the org
  key is NEVER used to embed queries or documents — every embedding path (with or without a connected
  row) produces vectors identical to the no-key lexical baseline, and no embed call leaves the
  process. The integration row is not even read on the embed path (the gate closes before resolution).

## 5. Design notes (slice-level names; keystone untouched)

- **`RoutingBrainKeyVerifier`** — dispatches the frozen `verify({key, token})` on the integration key:
  `voyage` → `VoyageKeyVerifier`, everything else → the S9 anthropic verifier selection. With
  `BRAIN_MODE=offline` the whole selection collapses to `StubBrainKeyVerifier` (no routing object).
- **`OrgKeyResolution.makeVoyage?`** — the injected per-org embedder factory (the `makeClaude`
  precedent); `makeClaude` becomes optional so a voyage-only deployment (platform `VOYAGE_API_KEY` but
  no Anthropic key — stub chat + real embeddings, the S16 posture) can still resolve org voyage keys.
  The coherence gate lives in TWO places: `brainFromEnv` builds `makeVoyage` only when the platform
  embedder is Voyage (wiring), and `forOrg` requires `makeVoyage` AND the platform Voyage embedder
  before the org-key embed path opens (authoritative — a hand-constructed `SelectingBrain` cannot
  bypass it). The `forOrg` handle returns `this` only when NEITHER chat-BYOK nor voyage-BYOK is wired
  (offline determinism + the BDD fault-injection seam preserved).
- **`embeddingBrainFor(brain, orgId)`** (application) — `orgId && hasBrainForOrg(brain)` →
  `brain.forOrg(orgId)`, else the brain itself. Org-less paths (global corpus ingest, the org-less
  `KnowledgeRetriever.retrieve`) keep the platform selection by construction.

## 6. Env vars

| Var | Meaning | Default |
|-----|---------|---------|
| `VOYAGE_API_KEY` | Platform key (S16) — defines the embedding space AND opens the coherence gate for org keys | unset → lexical space; org keys stored but unused |
| `VOYAGE_MODEL` | Voyage model for platform AND per-org embedders | `voyage-4` |
| `BRAIN_MODE=offline` | Pins lexical embeddings, the stub verifier, and disables voyage BYOK resolution | harness/CI default |

## 7. Test strategy

- **BDD (offline)** — `byok-voyage.feature`: catalog · connect stores secretRef + raw key nowhere in DB
  or audit · invalid key rejected · disconnect · MEMBER 403 · offline lexical self-report with a
  connected voyage row. All steps reuse the existing S6/S9/S16 step definitions.
- **TDD Docker-free** — domain catalog; application `voyage` connect/disconnect/leak/RBAC mirror of the
  anthropic suite + `embeddingBrainFor` routing through `forOrg` for search/upload/scoped grounding
  (and NOT for org-less paths); infra `VoyageKeyVerifier` against a stubbed fetch (ping shape, 401 →
  VALIDATION, outage propagation, blank-key local reject) + `brainKeyVerifierFromEnv` routing matrix +
  `SelectingBrain` org-voyage resolution (row re-read, vault read, cache, disconnect/rotation, platform
  fallback, key hygiene) + the **coherence gate** both direct-constructed and via `brainFromEnv`
  (platform-keyless + connected org key → vectors identical to the lexical baseline, zero network,
  the row never read; platform-voyage + org key → the org key reaches the wire); web voyage tile.
  The whole suite stays offline (stubbed fetch only).

## 8. Traceability matrix

| AC | Where verified |
|----|----------------|
| AC-VBYOK-01 | byok-voyage.feature (catalog) · domain test · web IntegrationsScreen test · api e2e catalog list |
| AC-VBYOK-02 | byok-voyage.feature (connect + leak sweep + invalid) · application integrations-ai tests · api e2e |
| AC-VBYOK-03 | byok-voyage.feature (disconnect + member 403) · application tests |
| AC-VBYOK-04 | byok-voyage.feature (lexical self-report with a connected row) · brainKeyVerifierFromEnv/brainFromEnv offline tests |
| AC-VBYOK-05 | selecting-brain voyage BYOK unit tests · application embeddingBrainFor tests |
| AC-VBYOK-06 | voyage-key-verifier unit tests |
| AC-VBYOK-07 | coherence-gate unit tests (direct `SelectingBrain` + `brainFromEnv`, lexical-baseline equality + zero network) |

## 9. Edge cases

| Edge case | Expected | AC |
|-----------|----------|-----|
| Connect with a blank/`invalid` key | `VALIDATION` 422; nothing stored | AC-VBYOK-02/06 |
| Voyage outage during verification | error propagates; connect fails; nothing stored | AC-VBYOK-06 |
| BYOK row whose vault entry is missing | fall through to the platform embedder for that call | AC-VBYOK-05 |
| Disconnect between two embed calls | second call re-reads the row → platform path | AC-VBYOK-05 |
| Key rotation (new secretRef) | cache miss by construction → rebuilt with the new key | AC-VBYOK-05 |
| Org key but NO platform `VOYAGE_API_KEY` | **coherence gate**: key stored+verified but unused; all embeds stay lexical (identical to no-key); the row is never read on the embed path | AC-VBYOK-07 |
| `BRAIN_MODE=offline` with keys + connected rows everywhere | lexical + stub verifier; zero network | AC-VBYOK-04 |
