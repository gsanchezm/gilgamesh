/**
 * Provider-agnostic voice port (slice 42, keystone §5 additive — no amendment): speech-to-text
 * (dictate a chat message) and text-to-speech (read an agent reply aloud). Consumed behind a
 * deterministic offline stub ({@link DeterministicVoice}); the real Azure Speech adapter drops in
 * later behind this same frozen port, selected by env (the Brain slice `AgentBrainPort` pattern).
 */

/** DI token for the {@link VoicePort} adapter (bound in both persistence wirings). */
export const VOICE = 'VOICE';

/** A recorded audio clip handed to STT: base64-encoded bytes + its MIME type (e.g. `audio/webm`). */
export interface AudioInput {
  /** Base64-encoded audio bytes (no data-URI prefix). */
  data: string;
  /** The clip's MIME type, e.g. `audio/webm`, `audio/wav`, `audio/ogg`. */
  mimeType: string;
}

/** Synthesized speech from TTS: base64-encoded bytes + its MIME type (e.g. `audio/mpeg`). */
export interface AudioOutput {
  /** Base64-encoded audio bytes (no data-URI prefix). */
  data: string;
  /** The synthesized clip's MIME type, e.g. `audio/mpeg`. */
  mimeType: string;
}

export interface VoicePort {
  /** Speech-to-text. `opts.language` is a BCP-47 hint; omitted = the provider default. */
  transcribe(audio: AudioInput, opts?: { language?: string }): Promise<{ text: string }>;
  /** Text-to-speech. `opts.voice` names a provider voice; omitted = the provider default. */
  synthesize(text: string, opts?: { voice?: string }): Promise<{ audio: AudioOutput }>;
}
