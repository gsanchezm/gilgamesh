# Programa paralelo v9 — design

**Date:** 2026-07-12 · **Owner:** Gilberto · **Cadence:** the v2–v8 parallel-program pattern
(SDD→BDD→TDD per stream in its own `pnpm wt` worktree, adversarial review, serialized stack gates,
sequential FF merges). Owner picked a **3-feature tanda** from the recommended parallel set, **plus a
mobile app chartered as a separate program** (not a slice in this batch).

**Owner decisions (this session):**
1. **Mobile "mirror of the web"** → Expo native, **phased, as its own program** — not forced into this
   batch. This doc only *charters* it (§Mobile charter); its real design is a separate brainstorming.
2. **Voice** → a `VoicePort` with a deterministic offline stub + a real cloud adapter behind it (the Brain
   pattern). Cloud provider left as an **open decision** (recommend Azure Speech; the port keeps it swappable).
3. **Reports per-tool** → a **keystone v0.7 amendment + Prisma migration** (add `tool`/`discipline` to
   `RunResult`), landed **in series on `main` first**, then the stream builds against the frozen contract.
4. **Tanda shape** → **3 worktrees now** (Stripe refunds · Voice · Reports); mobile spun off.

**Advisor refinements folded in:** charter (don't deep-spec) mobile · v0.7 in series first · keep Voice
**schema-free** (defer VoiceUsage metering) so **only Reports migrates** → the single real shared-file
collision (`schema.prisma`) is absorbed by the in-series Step 0 · voice provider surfaced as an explicit
open decision · the three are full slices **41/42/43**, the mobile charter is a separate deliverable.

Three disjoint domains → near-zero shared-file collisions (the `index.css`/`main.ts`/`schema.prisma` lessons):

| Stream | Slice | Blast radius (files) |
|---|---|---|
| **A · billing** | Stripe refunds (partial amount-level + `always_invoice` + refund preview) | `packages/domain/src/billing/*` · `packages/application/src/ports/payment.ts` · `use-cases/subscription.ts` · `payment/mock-payment-provider.ts` · `apps/api/src/infra/stripe-payment-provider.ts` · billing controllers/DTO · `BillingScreen`/`BillingClient` · `specs/slices/41-*` |
| **C · voice** | `VoicePort` chat STT/TTS | `packages/application/src/ports/voice.ts` (new port) + offline stub · `apps/api/src/infra/*-voice.ts` (adapter) + voice controller · DI wiring `persistence.module.ts`/`tokens.ts` + module registration · `ChatScreen`/`ChatClient` · `specs/slices/42-*` |
| **D · reports** | Per-tool ("Tools") breakdown | `packages/domain/src/execution/summarize*.ts` · `apps/web/src/screens/ReportsScreen.tsx` · runs client · **(schema already migrated in Step 0)** · `specs/slices/43-*` |

**Only Stream D touches `schema.prisma`, and only via Step 0 (in series, before the worktrees are cut).**
Stream C is the only stream adding a new port (its DI wiring is self-contained to the voice module + tokens).
Stream A reuses the `Invoice` model (slice 40 added no migration for refunds — verify at spec time).

Slice numbers: **A = 41**, **C = 42**, **D = 43** (continuing 1–40). The final `CLAUDE.md` +
`feature-status.md` board update is done by the orchestrator (serialized), never the subagents.

**Verification rule for the subagents (Tier-0 shared Postgres/Redis/ports): Docker-free only**
(`typecheck · lint · pnpm -r test`). The orchestrator runs the serialized `test:int` / `test:bdd` /
Playwright gates and applies the Step-0 migration to the shared dev DB (+ `prisma generate` in the main
checkout) **before** those gates.

---

## Step 0 (in series on `main`, before cutting worktrees) — Keystone v0.7

### Problem
`RunResult` records a per-scenario execution outcome but has **no tool/discipline dimension**, so the
Reports view (capture 08) cannot render the per-tool "Tools" breakdown. The board has flagged this since
the Reports view landed: *"per-tool 'Tools' breakdown deferred (needs a tool/discipline dimension on
`RunResult`)."*

### Amendment
- **Keystone vocabulary:** `RunResult` gains `tool` (string, e.g. `playwright` | `vitest` | `k6` | `zap`)
  and `discipline` (string, e.g. `e2e` | `unit` | `perf` | `security`). Both **nullable** — historical rows
  and any kernel that doesn't emit them stay valid. Bump keystone to **v0.7** with a §changelog entry.
- **Prisma migration:** add the two nullable columns to `run_results` (no backfill required; nullable). Both
  persistence wirings updated; `prisma generate` in the main checkout after the migration.
- **`DeterministicKernel` emits them deterministically** (same offline-stub posture as the rest of the
  kernel-backed surface) so the dimension is populated end-to-end today. **Honesty note (goes in the spec and
  the ReportsScreen copy/data path):** the per-tool breakdown renders **stub-emitted** tool/discipline until
  the real TOM/chaos-proxy kernel lands — identical posture to every other kernel-backed number.
- Domain `RunResult` type + `summarizeRun` unaffected in shape (the new fields are optional); the grouping
  fold is added in Slice 43.

### Why in series
Slice 43 builds against the frozen v0.7 contract; landing the amendment + migration first means the worktree
never races the shared dev DB. Streams A and C do **not** depend on v0.7 → they're unblocked regardless.

---

## Slice 41 (A) — Stripe refunds: partial (amount-level) + `always_invoice` + preview

### Problem
Slice 40 shipped programmatic proration + an **opt-in prorated refund of the unused period on cancel**
(a full-period credit invoice). Deferred there: **`always_invoice` mode** and **partial/line-level refunds**
plus **a refund-preview endpoint** (to show the exact "$Z" before committing). This slice closes them.

### Design — additive to the existing `PaymentProvider` port (keystone untouched)
Following the S13/S34/S40 additive-method precedent (no keystone amendment for a new provider capability):

```ts
// packages/application/src/ports/payment.ts  (additive)
previewRefund(orgId, { amountCents?, invoiceId? }): Promise<RefundPreview>; // computed, no charge
refund(orgId, { amountCents, reason?, invoiceId? }): Promise<RefundResult>; // partial amount (was full-period only)
changePlan(orgId, plan, { prorationBehavior?: 'create_prorations' | 'always_invoice' }): Promise<…>; // add always_invoice
```

- **Pure domain** (`packages/domain/src/billing/proration.ts`, the slice-40 single source): extend to compute
  a **partial** refundable amount (arbitrary `amountCents`, clamped to the invoice's refundable ceiling) — one
  source shared by preview + execute so the previewed "$Z" always equals the charged "$Z".
- **`always_invoice`** on `ChangeSubscription`: thread a `prorationBehavior` option through to the provider
  (`subscriptions.update({ proration_behavior: 'always_invoice' })`) → Stripe issues the proration invoice
  immediately instead of rolling it to the next cycle. Default stays `create_prorations` (slice-40 behavior;
  regression-safe, spy-verified).
- **Mock arm** — deterministic (Clock-derived), `previewRefund` returns the same figure the mock `refund`
  then writes as a negative-`amountCents` VOID credit `Invoice` row (slice-40 shape). Exact cents pinned in
  FakeClock unit tests; the e2e/BDD assert the refund **sign** and that preview == executed.
- **Stripe arm** — `refunds.create({ payment_intent, amount })` (partial amount) over the stored
  `providerSubscriptionId`/latest paid invoice; `INVOICE_WEBHOOK_EFFECTS` already maps `charge.refunded` /
  `credit_note.created` (slice 40). Secret **no-leak** asserted (the key never reaches the refund path).
- **API:** `POST /orgs/:orgId/subscription/refund` (execute) + `POST /orgs/:orgId/subscription/refund/preview`
  on the existing billing controller; OWNER/ADMIN gate; non-member → 404; no Stripe customer / nothing
  refundable → `VALIDATION`/422 (never 500).
- **Web:** BillingScreen refund control — amount input → **preview** ("$Z will be refunded") → confirm.
- **No migration** — reuses the `Invoice` model (**verify at spec time**: slice 40 added no schema change).
- **Offline:** `PAYMENTS_MODE=offline` / no `STRIPE_SECRET_KEY` → mock (all suites offline).

### BDD (AC-REFUND-01..) — sketch
partial-refund writes a credit invoice for exactly the requested amount · preview == executed amount ·
refund clamped to the refundable ceiling (over-refund → 422) · `always_invoice` issues the proration invoice
immediately · non-member → 404 · Stripe key never leaks.

---

## Slice 42 (C) — Voice in chat (STT dictate + TTS read-back)

### Problem
The chat composer ships with the mic **disabled** ("voice is a future slice"). This slice adds
speech-to-text (dictate a message) and text-to-speech (read an agent reply aloud) behind a port, offline in CI.

### Design — a new `VoicePort` (Brain-pattern: stub offline + real adapter)

```ts
// packages/application/src/ports/voice.ts  (new port)
export const VOICE = 'VOICE';
export interface VoicePort {
  transcribe(audio: AudioInput, opts?: { language?: string }): Promise<{ text: string }>;   // STT
  synthesize(text: string, opts?: { voice?: string }): Promise<{ audio: AudioOutput }>;      // TTS
}
```

- **Offline stub** (`DeterministicVoice`) — `transcribe` returns a deterministic transcript derived from the
  input length/hash (no network); `synthesize` returns a fixed tiny audio blob. Selected by
  `VOICE_MODE=offline` or a missing provider key. **All four harnesses pin `VOICE_MODE=offline`** (the
  `BRAIN/SSO/EMAIL/PAYMENTS/VAULT_MODE` idiom → now `+VOICE_MODE`).
- **Real adapter** — behind the port, chosen by env. **Open decision (§Open decisions):** recommend
  **Azure Speech** (infra coherence with ACA/Key Vault); the port makes it swappable, CI never calls it.
- **DI wiring** — bind `VOICE` in both persistence wirings (`persistence.module.ts` + `tokens.ts`), the one
  self-contained shared-file touch this batch; register a small `VoiceModule` (voice controller).
- **API** — `POST /chat/:sessionId/transcribe` (audio → text; rate-limited like the other chat mutations) and
  `POST /chat/:sessionId/speak` (text → audio). Same auth/RBAC as the existing chat routes; project-scoped.
- **Web** — ChatScreen composer: the mic button records (MediaRecorder, **batch**: record → upload →
  transcribe → drop the text into the composer, user still hits send); a "read aloud" affordance on an agent
  message plays `synthesize` output. The **SSE/streaming path is byte-for-byte untouched** (voice only wraps
  the composer + a per-message action).
- **No migration / no metering in the MVP** — VoiceUsage (à la BrainUsage) is a **named follow-up**, kept out
  so this stream stays schema-free and only Reports migrates.

### BDD (AC-VOICE-01..) — sketch
offline stub transcribes deterministically · a transcript lands in the composer without auto-sending · the
existing chat SSE path is unchanged (regression) · non-member → 404 · unconfigured provider → stub, never 500.

---

## Slice 43 (D) — Reports per-tool ("Tools") breakdown

### Problem
ReportsScreen (capture 08) is missing the per-tool "Tools" card because `RunResult` had no tool dimension —
now added in Step 0 (v0.7).

### Design — builds against the frozen v0.7 contract
- **Domain** — extend the pure `summarizeAcrossRuns` fold to also group results **by `tool`** (and expose a
  `discipline` roll-up), producing per-tool run-health counts + `ratePct`. Single source; no numbers
  duplicated in the UI.
- **Web** — `ReportsScreen` gains the "Tools" card faithful to capture 08 (per-tool rows: tool name, counts,
  1-decimal pass-rate). Reuses the existing runs client/API; **route already wired** at
  `/projects/:id/reports`.
- **Honesty** — the breakdown renders `DeterministicKernel`-emitted (stub) tool/discipline until the real TOM
  kernel lands; stated in the spec and reflected in the data path.
- **No new migration** (done in Step 0). No API change if the runs list already returns `RunResult` rows with
  the new fields — **verify at spec time**; if the read DTO strips them, widen the DTO (still no schema work).

### BDD (AC-REPORT-TOOL-01..) — sketch
results group by tool with correct counts + `ratePct` · a run with mixed tools splits correctly · zero-runs
project → empty "Tools" state (period-less EmptyState) · non-member → 404.

---

## Mobile charter (separate program — NOT a slice in this batch)

A one-page charter only. Its real design is its **own brainstorming → spec → plan** cycle.

- **Goal:** an Expo (React Native) app that **mirrors the web app**. **"Mirror" = feature/navigation parity,
  NOT code reuse.** `@gilgamesh/domain` (pure TS: design tokens, the 11-agent roster, pure logic) **is**
  shareable across web + native; `@gilgamesh/ui` (React DOM, CSS, `@testing-library/react`) **is not** → the
  mobile app needs its **own RN design-system** rebuilt to the same tokens.
- **Phase 1 scope (its first slice):** auth + dashboard (agent room). Everything else (chat, results,
  billing, knowledge, integrations, …) in later phases.
- **Two decisions its own brainstorming must make first:**
  1. **API auth mode = Bearer token.** The web uses `__Host-`/`SameSite` httpOnly cookies + CSRF
     double-submit, which **do not work in a native app**. Mobile needs a token-based auth flow — which will
     eventually **touch the auth module**. That is exactly why the mobile work must stay **OUT of this
     batch's three streams** (it would break their disjointness).
  2. **Mirror fidelity bar** — pixel-faithful native re-skin vs. functional parity first. (Deferred to the
     mobile brainstorming.)
- **Backend:** the same API (no second backend). Reuses every existing use case/controller; adds only the
  Bearer-token auth seam.
- **Placement:** a new `apps/mobile` (Expo + expo-router) workspace; `@gilgamesh/domain` as a workspace dep.

**Deliverable of this program's mobile track:** just this charter. No `apps/mobile` scaffold is created until
the mobile program is brainstormed and its Phase-1 spec clears its own review gate.

---

## Orchestration

1. **Step 0 in series on `main`:** keystone v0.7 amendment + `run_results` migration + `DeterministicKernel`
   emits tool/discipline + `prisma generate` in the main checkout. Full stack gate. Commit.
2. **Cut three worktrees** (`pnpm wt`): `slice-41-stripe-refunds`, `slice-42-voice`, `slice-43-reports-per-tool`.
   Each is a Claude subagent doing full SDD→BDD→TDD, **verifying Docker-free only** (Tier-0).
3. **Adversarial review** per stream (real mutation testing), fixes applied in-worktree.
4. **Serialized integration:** rebase each onto `main`, FF-merge **41 → 42 → 43** (order arbitrary; domains
   disjoint), re-running the serialized stack gates (`test:int` / `test:bdd` / Playwright) per merge on a
   quiet machine (the v7 lesson: don't run stack gates while subagents build).
5. **Orchestrator-only** final `CLAUDE.md` + `feature-status.md` board update; push to `origin/main` when the
   owner says so (gated build).

**Collision ledger (verified disjoint):**
- `schema.prisma` — **D only**, absorbed by Step 0 (in series). A reuses `Invoice`; C is schema-free.
- DI wiring (`persistence.module.ts`/`tokens.ts`, module registration) — **C only** (the new `VoicePort`).
- Web screens — Billing (A) / Chat (C) / Reports (D), disjoint files.
- `config.ts` / harness `*_MODE` pins — C adds `VOICE_MODE=offline` to the four harnesses; A/D don't touch it.

---

## Open decisions (surface at the spec review gate)

- **Voice cloud provider (Slice 42).** Recommend **Azure Speech** (coherent with the existing Azure infra:
  ACA, Key Vault, Managed Identity; STT + TTS in one SDK). Alternatives: OpenAI (Whisper + TTS), Deepgram,
  ElevenLabs. The `VoicePort` keeps it swappable and CI always runs the stub, so this choice carries only
  cost/privacy/BYOK weight — not architectural risk. **Owner to confirm at review.**

## Deferred (named, not built this program)

- **VoiceUsage metering** (à la BrainUsage) — kept out so Voice stays schema-free; a follow-up slice.
- **Mobile app** — chartered here; its own brainstorming → spec → plan.
- **Streaming STT** (partial transcripts) — MVP is batch record→transcribe.
- Stripe `always_invoice`-only edge modes / line-item-level (vs amount-level) refunds beyond the MVP.
- Real TOM kernel emitting genuine tool/discipline (Reports shows stub data until then).
- Everything prior unchanged: Orchestration DAG · Session replay · voice-in-mobile · Bloque-3 owner decisions
  (rate-limit fail-open · pagination · RAG posture) · billing period scheduler.
