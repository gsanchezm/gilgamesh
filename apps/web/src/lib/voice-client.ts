import { sendJson } from './http';

/** A base64-encoded audio clip + its MIME type — the wire shape for both STT input and TTS output. */
export interface VoiceAudio {
  data: string;
  mimeType: string;
}

/**
 * Voice in chat (slice 42): STT dictate + TTS read-back over the session-scoped voice routes. Both
 * are mutations (`sendJson`, CSRF double-submit); the session-scoped authz + non-member 404 live in
 * the API use cases. The SSE/streaming chat path is untouched — voice only feeds the composer and a
 * per-message action.
 */
export interface VoiceClient {
  /** Audio → text (dictate). The transcript is dropped into the composer; the user still sends. */
  transcribe(sessionId: string, audio: VoiceAudio, language?: string): Promise<{ text: string }>;
  /** Text → audio (read aloud). */
  speak(sessionId: string, text: string, voice?: string): Promise<{ audio: VoiceAudio }>;
}

export const httpVoiceClient: VoiceClient = {
  transcribe: (sessionId, audio, language) =>
    sendJson('POST', `/chat/${sessionId}/transcribe`, { audio, language }, 'Could not transcribe the audio.'),
  speak: (sessionId, text, voice) =>
    sendJson('POST', `/chat/${sessionId}/speak`, { text, voice }, 'Could not read the message aloud.'),
};
