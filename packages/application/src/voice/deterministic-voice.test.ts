import { describe, expect, it } from 'vitest';
import { DeterministicVoice } from './deterministic-voice';
import type { AudioInput } from '../ports/voice';

const clip = (data: string, mimeType = 'audio/webm'): AudioInput => ({ data, mimeType });

describe('DeterministicVoice (offline VoicePort stub)', () => {
  it('transcribes deterministically — same audio bytes → identical transcript (AC-VOICE-01)', async () => {
    const voice = new DeterministicVoice();
    const audio = clip('aGVsbG8gcGFudGhlb24='); // base64("hello pantheon")
    const a = await voice.transcribe(audio);
    const b = await voice.transcribe(audio);
    expect(a.text).toBe(b.text);
    expect(a.text.length).toBeGreaterThan(0);
    // A fresh instance yields the same value — no per-instance / clock / random state.
    expect((await new DeterministicVoice().transcribe(audio)).text).toBe(a.text);
  });

  it('varies the transcript with the input (different bytes → different transcript)', async () => {
    const voice = new DeterministicVoice();
    const a = await voice.transcribe(clip('AAAA'));
    const b = await voice.transcribe(clip('BBBBBBBB'));
    expect(a.text).not.toBe(b.text);
  });

  it('synthesizes a fixed, non-empty base64 audio blob with a MIME type', async () => {
    const voice = new DeterministicVoice();
    const { audio } = await voice.synthesize('Zeus here.');
    expect(audio.mimeType).toMatch(/^audio\//);
    expect(audio.data.length).toBeGreaterThan(0);
    // Deterministic: the same text yields the same blob, on any instance.
    const again = await new DeterministicVoice().synthesize('Zeus here.');
    expect(again.audio).toEqual(audio);
  });

  it('never throws on empty input (unconfigured-provider fallback must not 500 — AC-VOICE-05)', async () => {
    const voice = new DeterministicVoice();
    await expect(voice.transcribe(clip(''))).resolves.toEqual({ text: expect.any(String) });
    await expect(voice.synthesize('')).resolves.toEqual({ audio: expect.objectContaining({ data: expect.any(String) }) });
  });
});
