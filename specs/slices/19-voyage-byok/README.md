# Slice 19 — Voyage BYOK (per-org Voyage embedding key) (SDD Spec)

> Spec-Driven-Design spec for the nineteenth vertical slice of Gilgamesh.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) over the prototype where they conflict.
> All entity/field/enum/port/path names below are used **verbatim** from the keystone (**v0.6** — this slice
> consumes the v0.6 amendment: `voyage` integration key, §8 group `AI_PROVIDERS`).
> v0.1 — 2026-07-06. Status: IN PROGRESS on branch `feat-voyage-byok`.
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
   on the very next call) + an orgId+secretRef LRU-ish instance cache. Fallback chain per call:
   **org `voyage` key → platform `VOYAGE_API_KEY` env → deterministic lexical-hash stub**.
4. **Offline seam unchanged** — `BRAIN_MODE=offline` (all four harnesses + CI + api test-setup default)
   pins the lexical embedder AND the stub verifier; no suite ever calls the network. Unlike anthropic
   (whose BYOK requires the platform key/auto mode), voyage BYOK is gated ONLY on the explicit offline
   pin: an org's voyage key must work even when the platform has no `VOYAGE_API_KEY` (that key is the
   fallback, not the prerequisite).
5. **No keystone change** — `voyage` is already frozen in §8 (v0.6). No new entities, routes, or ports;
   the frozen `BrainKeyVerifier.verify({key, token})` already carries the provider key to dispatch on.

---

## 1. Feature intent

Let an org bring its own Voyage API key exactly like a repo or anthropic integration — verified once,
stored only as a vault `secretRef`, raw key discarded — so that org's knowledge search, document upload,
and chat/generate grounding embed with **its** Voyage key at call time, falling back to the platform key,
and to the deterministic lexical stub when no key exists anywhere. All offline/CI behavior is unchanged.

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
  (`OrgKeyResolution.makeVoyage` factory + a second LRU cache, decision S19-3); `brainFromEnv` wires
  the voyage factory whenever `BRAIN_MODE != offline`.
- **web** — the Integrations screen is data-driven from the server catalog; the voyage tile appears,
  connects, and disconnects with zero new wiring (covered by a unit assertion).

### Out of scope (explicitly deferred)
- Per-org Voyage **model** override (config json) — the org key uses the platform `VOYAGE_MODEL`.
- Per-org embedding-space partitioning — one shared `vector(1024)` column; a BYOK org embeds into the
  same space (queries and documents embedded under whichever key resolves; acceptable because both
  paths emit `voyage-4` at 1024 — documented posture).
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
- **AC-VBYOK-05 (call-time resolution)** — with voyage BYOK active (not explicitly offline): every
  org-attributable embed (knowledge search, document upload, scoped chat/generate grounding) resolves
  the org's `voyage` Integration row per call — org key → platform `VOYAGE_API_KEY` → lexical stub;
  the per-org embedder is cached by orgId+secretRef (LRU-ish, shared cap) so a disconnect or key
  rotation takes effect on the very next call; the resolved key is never logged, thrown, or persisted.
- **AC-VBYOK-06 (verification ping)** — `VoyageKeyVerifier` makes ONE minimal embed request with the
  candidate key; non-retryable 4xx (except 408/429) → `VALIDATION`; timeout/429/5xx propagate (an
  outage never silently accepts a key); a blank key is rejected locally without any network call.

## 5. Design notes (slice-level names; keystone untouched)

- **`RoutingBrainKeyVerifier`** — dispatches the frozen `verify({key, token})` on the integration key:
  `voyage` → `VoyageKeyVerifier`, everything else → the S9 anthropic verifier selection. With
  `BRAIN_MODE=offline` the whole selection collapses to `StubBrainKeyVerifier` (no routing object).
- **`OrgKeyResolution.makeVoyage?`** — the injected per-org embedder factory (the `makeClaude`
  precedent); `makeClaude` becomes optional so a voyage-only deployment (no platform Anthropic key —
  stub chat + real embeddings, the S16 posture) can still resolve org voyage keys. The `forOrg` handle
  returns `this` only when NEITHER chat-BYOK nor voyage-BYOK is wired (offline determinism + the BDD
  fault-injection seam preserved).
- **`embeddingBrainFor(brain, orgId)`** (application) — `orgId && hasBrainForOrg(brain)` →
  `brain.forOrg(orgId)`, else the brain itself. Org-less paths (global corpus ingest, the org-less
  `KnowledgeRetriever.retrieve`) keep the platform selection by construction.

## 6. Env vars

| Var | Meaning | Default |
|-----|---------|---------|
| `VOYAGE_API_KEY` | Platform fallback key (S16) | unset → org key or lexical |
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
  and stub fallbacks, key hygiene); web voyage tile.

## 8. Traceability matrix

| AC | Where verified |
|----|----------------|
| AC-VBYOK-01 | byok-voyage.feature (catalog) · domain test · web IntegrationsScreen test · api e2e catalog list |
| AC-VBYOK-02 | byok-voyage.feature (connect + leak sweep + invalid) · application integrations-ai tests · api e2e |
| AC-VBYOK-03 | byok-voyage.feature (disconnect + member 403) · application tests |
| AC-VBYOK-04 | byok-voyage.feature (lexical self-report with a connected row) · brainKeyVerifierFromEnv/brainFromEnv offline tests |
| AC-VBYOK-05 | selecting-brain voyage BYOK unit tests · application embeddingBrainFor tests |
| AC-VBYOK-06 | voyage-key-verifier unit tests |

## 9. Edge cases

| Edge case | Expected | AC |
|-----------|----------|-----|
| Connect with a blank/`invalid` key | `VALIDATION` 422; nothing stored | AC-VBYOK-02/06 |
| Voyage outage during verification | error propagates; connect fails; nothing stored | AC-VBYOK-06 |
| BYOK row whose vault entry is missing | fall through to platform key / stub for that call | AC-VBYOK-05 |
| Disconnect between two embed calls | second call re-reads the row → platform/stub path | AC-VBYOK-05 |
| Key rotation (new secretRef) | cache miss by construction → rebuilt with the new key | AC-VBYOK-05 |
| Org key but NO platform `VOYAGE_API_KEY` | org embeds via its key; org-less paths stay lexical | AC-VBYOK-05 |
| `BRAIN_MODE=offline` with keys + connected rows everywhere | lexical + stub verifier; zero network | AC-VBYOK-04 |
