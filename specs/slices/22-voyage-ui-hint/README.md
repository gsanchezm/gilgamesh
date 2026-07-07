# Slice 22 — Voyage BYOK "connected-but-gated" UI hint

Status: in progress (branch `feat-voyage-ui-hint`). Closes the programa-v3 deferred follow-up
*"UI hint for a connected-but-gated voyage key"*.

## Problem

An org can connect its own Voyage API key through the S6/S19 integration flow. But because of the
**coherence gate** (owner decision S19-6, see `apps/api/src/infra/selecting-brain.ts` and the S19
spec), that org key only actually embeds when the **platform** already has a live Voyage space —
i.e. `VOYAGE_API_KEY` is set AND `BRAIN_MODE != offline`. When the platform is Voyage-keyless, a
connected org key sits vaulted but **UNUSED**: every embed path stays on the deterministic lexical
stub so retrieval can never silently degrade (an org key would otherwise fork the space the stored
corpus lives in — cross-space cosine is garbage).

Today the Integrations UI gives **no indication** of this gated state. A user who connects a Voyage
key reasonably assumes semantic embeddings are now active — when in fact nothing changed. This slice
surfaces the gated state honestly.

The platform-Voyage-space truth is **server-only** (env: `VOYAGE_API_KEY` + brain mode). The SPA
cannot see it, so the server must expose it on an existing response.

## Scope

- **In:** surface a per-row boolean on the existing Integrations list/mutation response
  (`GET /orgs/{orgId}/integrations`, `PATCH /orgs/{orgId}/integrations/{key}`) and render an
  inactive/gated notice on the Voyage integration card when the org key is connected but the
  platform space is lexical.
- **Out (no change):** no new HTTP route; no keystone vocabulary change; no Billing surface change;
  no re-embedding, provenance, or actual embedding behavior change (the coherence gate itself is
  unchanged — this slice only *reports* it). Anthropic and source-repo integrations are untouched.

## Acceptance

- **AC-VUIH-01 — gated notice when connected over a lexical platform space.** Given the org's
  `voyage` integration is connected AND the platform has **no** live Voyage space, the Integrations
  UI shows a clear inactive notice: *"Connected — inactive: no platform Voyage space, embeddings
  stay lexical."*
- **AC-VUIH-02 — no notice when the platform space is live.** Given the platform Voyage space **is**
  active, a connected `voyage` key is live; the UI shows the normal "Connected" state with **no**
  gated notice.
- **AC-VUIH-03 — no notice when not connected.** A disconnected `voyage` card shows the normal
  "Not connected" state with no gated notice, regardless of platform state.
- **AC-VUIH-04 — additive, non-leaking.** The new field is additive-optional; it carries no secret,
  token, or `secretRef`; non-`voyage` rows are unaffected; and consumers that don't wire the platform
  status (or old clients) see the field absent and render exactly as before.

## Design

### The surfaced field (additive-optional, no keystone change)

Extend the application **`IntegrationView`** DTO (returned by `ListIntegrations` and by
`ConnectIntegration`/`DisconnectIntegration`) with:

```ts
/** S21: platform-only (env) truth the client can't see. Present ONLY on the `voyage` row when the
 *  platform embedding-status port is wired: true = the platform Voyage space is live (a connected
 *  org key embeds); false = lexical platform space (a connected key sits vaulted but UNUSED — the
 *  S19 coherence gate). Absent on every other row and when the status port is not wired. */
platformVoyageActive?: boolean;
```

Additive-not-breaking because: (a) it is a new **optional** field — omitting it (all non-voyage rows,
and any wiring without the status port) is a superset-compatible response; (b) the keystone only
freezes the *routes*, not the response body (`specs/_keystone/foundation-vocabulary.md` §6 lists
`GET/PATCH /orgs/{orgId}/integrations` with no DTO shape) — verified, so no `specs/_keystone/*` edit.

### Where the truth comes from

`SelectingBrain.embeddings` is already `'voyage' | 'lexical'` and is exactly the coherence-gate
predicate (`brains.voyage` present ⇔ the platform Voyage space is live ⇔ an org key embeds). A tiny
application port **`PlatformEmbeddingStatus { voyageActive(): boolean }`** exposes it; `SelectingBrain`
implements it. `ListIntegrations`/`Connect`/`Disconnect` take it as an **optional** dep (via the shared
`IntegrationDeps` bundle) and stamp `platformVoyageActive` onto the `voyage` row only. Wiring it into
the shared bundle means the `Connect` response also carries the flag, so the hint appears immediately
after connecting (the web `replace()`s the row) with no reload.

### Web

`IntegrationsScreen` renders the amber advisory on a card when
`i.key === 'voyage' && i.connected && i.platformVoyageActive === false` (strict `=== false`, so an
absent/`undefined` field — "unknown" — renders nothing). Amber (`--amber`) is the correct semantic:
this is an advisory, not an error.

## Verification

SDD → BDD → TDD. Docker-free suites only (`pnpm --filter @gilgamesh/<pkg> test`, `pnpm -r typecheck`,
`pnpm lint`).

- **application** — `ListIntegrations`/`Connect` stamp the flag for `voyage` from an injected status
  (`voyageActive() === true` → `true`; `=== false` → `false`; dep omitted → field absent); non-voyage
  rows never carry it. This is where **both** platform states are exercised (trivially, via fakes).
- **api** — `SelectingBrain.voyageActive()` mirrors `embeddings`; the `GET .../integrations` e2e shows
  the `voyage` row with `platformVoyageActive === false` (the offline harness is always lexical).
- **web** — `IntegrationsScreen` shows the gated notice when connected+inactive, hides it when active,
  hides it when disconnected.
- **BDD** — one scenario (**AC-VUIH-01**) in `specs/slices/19-voyage-byok/byok-voyage.feature` for the
  reachable **inactive/gated** state. The **active** state is **unreachable in the offline harness by
  design** (the sweep pins `BRAIN_MODE=offline`/no `VOYAGE_API_KEY`, so `embeddings` is always
  `lexical`); it is covered by the application + web unit tests above rather than forced through the
  network.
