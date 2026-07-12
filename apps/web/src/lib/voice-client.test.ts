import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpVoiceClient } from './voice-client';

type FetchInit = { method?: string; credentials?: string; headers?: Record<string, string>; body?: string };

function mockFetch(payload: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => payload })),
  );
}
const lastCall = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, FetchInit];

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('httpVoiceClient', () => {
  it('transcribe POSTs the audio to the session with the CSRF token', async () => {
    document.cookie = 'csrf=tok-9';
    mockFetch({ text: 'run the checkout feature' });
    const audio = { data: 'AAAA', mimeType: 'audio/webm' };
    expect(await httpVoiceClient.transcribe('s1', audio)).toEqual({ text: 'run the checkout feature' });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/transcribe$/);
    expect(init.method).toBe('POST');
    expect(init.headers?.['X-CSRF-Token']).toBe('tok-9');
    expect(JSON.parse(init.body!)).toEqual({ audio });
  });

  it('speak POSTs the text to the session', async () => {
    mockFetch({ audio: { data: 'BBBB', mimeType: 'audio/mpeg' } });
    expect(await httpVoiceClient.speak('s1', 'Zeus here.')).toEqual({ audio: { data: 'BBBB', mimeType: 'audio/mpeg' } });
    const [url, init] = lastCall();
    expect(String(url)).toMatch(/\/chat\/s1\/speak$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body!)).toEqual({ text: 'Zeus here.' });
  });

  it('surfaces the RFC9457 detail on failure (e.g. non-member 404)', async () => {
    mockFetch({ detail: 'Chat session not found.' }, false, 404);
    await expect(httpVoiceClient.transcribe('nope', { data: 'A', mimeType: 'audio/webm' })).rejects.toThrow(
      'Chat session not found.',
    );
  });
});
