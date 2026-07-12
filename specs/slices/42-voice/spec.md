# Slice 42 — Voice in chat (STT dictate + TTS read-back) (SDD Spec)

> Spec-Driven-Design spec for the voice vertical slice of Gilgamesh (programa v9, stream C).
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) for all names/enums/ports/paths
> → **Decisions log** (`docs/research/decisions-log.md`) → **Prototype extract**.
> Provider = **Azure Speech**, owner-CONFIRMED 2026-07-12 (design doc
> `docs/superpowers/specs/2026-07-12-programa-v9-design.md`, §Slice 42).
> Status: BUILT — SDD→BDD→TDD, Docker-free green on branch `slice-42-voice`.
> Scope: speech-to-text (dictate a message) + text-to-speech (read an agent reply aloud) behind a new
> `VoicePort`, **schema-free** (no migration, no metering — VoiceUsage is a named follow-up).

---

## 0. Owner decision S42

Owner picked voice (STT + TTS) as programa-v9 stream C, provider **Azure Speech** (2026-07-12,
"adelante en todo"). The chat composer shipped with the mic **disabled** ("voice is a future slice",
slice 11); this slice turns it on.

**Decision S42 — wire `VoicePort` to a deterministic offline stub (`DeterministicVoice`), selected by
`VOICE_MODE=offline` or a missing provider key** — the Brain slice pattern (`BRAIN_MODE`/`brainFromEnv`,
`EMAIL_MODE`/`emailFromEnv`). Consequences:
- **Offline, reproducible, NOT network-bound**: every test harness pins `VOICE_MODE=offline`; the stub
  transcribes deterministically from the input (length/hash) and synthesizes a fixed tiny audio blob.
- **Real STT/TTS** lands via the `AzureVoice` adapter (Azure Cognitive Services Speech REST) behind the same
  frozen port, chosen only when `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` are set and `VOICE_MODE != offline`.
  The provider key never reaches logs/errors; the port keeps it swappable and CI never calls it.
- **No schema change / no metering** this slice (unlike Brain's `BrainUsage`). VoiceUsage à la `BrainUsage`
  is a named follow-up so only Reports (slice 43) migrates in programa v9.
- **Batch, not streaming**: the mic records → uploads → transcribes → drops the text into the composer;
  the user still hits send (NO auto-send). Streaming (partial) STT is a named follow-up.

---

## 1. Ports (application)

`packages/application/src/ports/voice.ts` — a NEW provider-agnostic port + DI token, mirroring the Brain
port's shape (frozen, additive):

```ts
export const VOICE = 'VOICE';

/** A recorded audio clip: base64-encoded bytes + its MIME type (e.g. audio/webm, audio/wav). */
export interface AudioInput { data: string; mimeType: string }
/** Synthesized speech: base64-encoded bytes + its MIME type (e.g. audio/mpeg). */
export interface AudioOutput { data: string; mimeType: string }

export interface VoicePort {
  /** Speech-to-text. `opts.language` is a BCP-47 hint (default provider config). */
  transcribe(audio: AudioInput, opts?: { language?: string }): Promise<{ text: string }>;
  /** Text-to-speech. `opts.voice` names a provider voice (default provider config). */
  synthesize(text: string, opts?: { voice?: string }): Promise<{ audio: AudioOutput }>;
}
```

- `DeterministicVoice` (`packages/application/src/voice/deterministic-voice.ts`) — the offline stub. No
  network, no `Date.now`/`Math.random`: `transcribe` derives a stable transcript from the audio bytes
  (length + FNV-style hash), `synthesize` returns a fixed tiny base64 audio blob (`audio/mpeg`).

## 2. Use cases (application) — authz lives here

Two use cases, both session-scoped exactly like `GetChatEvents` (`findById` → `NOT_FOUND` if absent, then
`requireProjectAccess([OWNER,ADMIN,MEMBER])` → `NOT_FOUND` for a non-member — never 403, tenant existence
is not leaked):

- `TranscribeChatAudio` — `{ userId, sessionId, audio }` → `{ text }` (delegates to `voice.transcribe`).
- `SynthesizeChatSpeech` — `{ userId, sessionId, text }` → `{ audio }` (delegates to `voice.synthesize`).

Both bound the text/audio at the DTO layer; neither persists a message (batch dictate → composer; read-aloud
of an already-shown agent message). No audit row (content-free by omission; VoiceUsage metering deferred).

## 3. API (apps/api)

`VoiceModule` + `VoiceController` (its own controller — the chat SSE `ChatController` is untouched):
- `POST /chat/:sessionId/transcribe` — body `{ audio: { data, mimeType } }` → `{ text }`.
- `POST /chat/:sessionId/speak` — body `{ text }` → `{ audio: { data, mimeType } }`.

Same `SessionAuthGuard` + CSRF + project-scope as the other chat mutations; both are added to the global
`RateLimitGuard` `LIMITED_PATHS` (`bucket:'suffix'`, `method:'POST'`) so they inherit the `/messages` per-IP
brain-cost limit (no new rate-limit knob). The audio DTO field is capped at `INPUT_LIMITS.voiceAudioMax`
(= `featureContentMax`, 256 KiB) so the `JSON_BODY_LIMIT` (512 KiB) invariant and its e2e stay valid.

DI: `VOICE` token bound in BOTH persistence wirings via `voiceFromEnv(process.env)`.

## 4. Web (apps/web)

`voice-client.ts` (`VoiceClient.transcribe`/`speak` over `sendJson`) + the ChatScreen composer:
- The mic button records via `MediaRecorder`/`getUserMedia` **behind a feature-detect seam** (an injectable
  `createRecorder`, default browser; unsupported → null → no-op, exactly as `openLive` guards `EventSource`).
  On stop: upload → `voiceClient.transcribe` → set the composer `draft` to the transcript. NO auto-send.
- A "Read aloud" action on each agent message calls `voiceClient.speak` → plays via an injectable
  `playAudio` seam (default browser `Audio`).
- **The SSE/streaming path is byte-for-byte unchanged**: voice lives in NEW handlers; `send`, `openLive`,
  `resync`, and the DELTA/MESSAGE/DONE listeners are not edited.

## 5. Harnesses

`VOICE_MODE=offline` is added to all four harnesses + the api test-setup default (the
`BRAIN/SSO/EMAIL/PAYMENTS/VAULT_MODE` idiom): `apps/api/vitest.config.ts`, `apps/api/vitest.int.config.ts`,
`apps/api/cucumber.cjs`, `apps/web/playwright.config.ts`, `apps/api/test/setup.ts`.

## 6. Acceptance (BDD `AC-VOICE-01..05`)

- **AC-VOICE-01** — the offline stub transcribes **deterministically** (same audio bytes → same transcript;
  no network / no clock / no randomness).
- **AC-VOICE-02** — a dictated transcript lands in the composer **without auto-sending** (the user still
  presses Send).
- **AC-VOICE-03** — the existing chat **SSE path is byte-for-byte unchanged** (regression: `openLive`/DELTA/
  MESSAGE/DONE/`send`/`resync` untouched; existing chat unit + e2e stay green).
- **AC-VOICE-04** — a **non-member → 404** on both voice routes (tenant existence not leaked).
- **AC-VOICE-05** — an **unconfigured provider → the stub, never a 500** (`voiceFromEnv` selects
  `DeterministicVoice` when `VOICE_MODE=offline` or no `AZURE_SPEECH_KEY`).

Executable proof (Docker-free): application unit tests (01 determinism, 04 404, `voiceFromEnv` 05), api e2e
(routes + 404 + unconfigured→stub), web unit (02 transcript→composer + no-auto-send; SSE-path diff for 03).
The `.feature` is `@wip @ui` (like AC-AUTH-13 / slice 39) — the sweep skips it; unit/e2e are the proof.

## 7. Deferred (named)

VoiceUsage metering (à la `BrainUsage`) · streaming/partial STT · per-agent voices · voice in the mobile app.
