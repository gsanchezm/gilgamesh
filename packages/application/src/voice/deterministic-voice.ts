import type { AudioInput, AudioOutput, VoicePort } from '../ports/voice';

/**
 * Deterministic, offline {@link VoicePort} stub (slice 42, owner decision S42 — the
 * {@link DeterministicBrain} pattern): no network, no `Date.now`, no `Math.random`. The real Azure
 * Speech adapter drops in later behind the same frozen port. Selected by `voiceFromEnv` whenever
 * `VOICE_MODE=offline` or the provider key is absent, so every test harness runs against it.
 *
 * `transcribe` derives a stable transcript from the audio bytes (length + an FNV-1a hash), so the
 * same clip always yields the same words and different clips differ — enough for a UI/e2e to assert
 * a transcript landed without any real speech engine. `synthesize` returns a fixed tiny audio blob.
 */
export class DeterministicVoice implements VoicePort {
  async transcribe(audio: AudioInput, _opts?: { language?: string }): Promise<{ text: string }> {
    void _opts;
    const bytes = audio.data ?? '';
    const words = STUB_WORDS.length;
    // Pick a small, stable word sequence from the hash so the transcript reads like a phrase and is
    // reproducible for the same input (AC-VOICE-01) yet varies with the input.
    const seed = fnv1a(`${bytes.length}:${bytes}`);
    const count = 3 + (seed % 4); // 3..6 words — always non-empty, even for empty audio
    const out: string[] = [];
    let h = seed;
    for (let i = 0; i < count; i++) {
      out.push(STUB_WORDS[h % words]!);
      h = fnv1a(String(h));
    }
    return { text: out.join(' ') };
  }

  async synthesize(text: string, _opts?: { voice?: string }): Promise<{ audio: AudioOutput }> {
    void text;
    void _opts;
    // A fixed, tiny, valid-shaped audio payload (a few silent bytes, base64). The offline stub does
    // not render real speech — the web plays whatever the port returns; the real adapter returns MP3.
    return { audio: { data: STUB_AUDIO_BASE64, mimeType: 'audio/mpeg' } };
  }
}

/** A closed vocabulary the stub draws deterministic transcripts from (no external corpus). */
const STUB_WORDS = [
  'run',
  'the',
  'checkout',
  'feature',
  'please',
  'test',
  'login',
  'and',
  'report',
  'status',
  'now',
  'again',
] as const;

/** Fixed silent-ish MP3-ish stub blob (base64) — deterministic, non-empty, small. */
const STUB_AUDIO_BASE64 = 'SUQzBAAAAAAAF1RTU0UAAAANAAADTGF2ZjYwLjMuMTAwAAAAAAAA';

/** FNV-1a 32-bit over the UTF-16 code units — pure, deterministic, no allocation of Buffers. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept unsigned.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
