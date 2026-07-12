import type { VoiceAudio } from './voice-client';

/**
 * Browser microphone capture behind a small seam so ChatScreen stays unit-testable (jsdom has no
 * `MediaRecorder`/`getUserMedia`). The default (`createBrowserRecorder`) feature-detects exactly like
 * ChatScreen's `openLive` guards `EventSource`: unsupported → `null`, so the mic click is a safe
 * no-op. Tests inject a fake `CreateRecorder`, so no browser API is ever touched.
 */

/** An in-progress recording handle: stop to get the clip, or cancel to discard it. */
export interface VoiceRecorder {
  /** Stops recording and resolves the captured clip (base64 + MIME). */
  stop(): Promise<VoiceAudio>;
  /** Aborts recording and releases the mic without producing a clip. */
  cancel(): void;
}

/** Starts a recording; resolves a handle. `null` when the browser can't record (feature-detect). */
export type CreateRecorder = (() => Promise<VoiceRecorder>) | null;

/** Reads a Blob into base64 (no `data:` prefix) via FileReader — the browser path only. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.onloadend = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * The real recorder factory: `null` when `MediaRecorder`/`getUserMedia` are unavailable (jsdom/SSR/
 * unsupported browsers), else a starter that opens the mic and returns a stop/cancel handle.
 */
export function createBrowserRecorder(): CreateRecorder {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    return null;
  }
  return async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();
    const release = () => stream.getTracks().forEach((t) => t.stop());
    return {
      stop: () =>
        new Promise<VoiceAudio>((resolve, reject) => {
          recorder.onstop = () => {
            release();
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            blobToBase64(blob).then(
              (data) => resolve({ data, mimeType: blob.type || 'audio/webm' }),
              (err) => reject(err),
            );
          };
          recorder.stop();
        }),
      cancel: () => {
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          /* already stopped */
        }
        release();
      },
    };
  };
}

/** Plays a synthesized clip (read aloud). Feature-detected; a no-op if `Audio` is unavailable. */
export function playVoiceAudio(audio: VoiceAudio): void {
  if (typeof Audio === 'undefined') return;
  try {
    const el = new Audio(`data:${audio.mimeType};base64,${audio.data}`);
    void el.play().catch(() => {
      /* autoplay policy / no output device — best-effort */
    });
  } catch {
    /* construction failed — best-effort */
  }
}
