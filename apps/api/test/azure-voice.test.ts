import { DeterministicVoice } from '@gilgamesh/application';
import { describe, expect, it, vi } from 'vitest';
import {
  AzureVoice,
  AzureVoiceError,
  resolveVoiceMode,
  voiceFromEnv,
  type VoiceHttp,
  type VoiceHttpResponse,
} from '../src/infra/azure-voice';

const KEY = 'super-secret-speech-key';
const REGION = 'eastus2';

function okJson(body: unknown): VoiceHttpResponse {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => JSON.stringify(body),
  };
}
function okAudio(bytes: Uint8Array): VoiceHttpResponse {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => ab,
    text: async () => '',
  };
}

describe('AzureVoice (real STT/TTS adapter behind the injected transport seam)', () => {
  it('transcribes: posts to the STT endpoint with the key header, returns DisplayText', async () => {
    let seen: { url: string; headers: Record<string, string>; body: unknown } | null = null;
    const http: VoiceHttp = vi.fn(async (url, init) => {
      seen = { url, headers: init.headers, body: init.body };
      return okJson({ RecognitionStatus: 'Success', DisplayText: 'run the checkout feature' });
    });
    const voice = new AzureVoice({ apiKey: KEY, region: REGION, http });
    const { text } = await voice.transcribe({ data: Buffer.from('audio').toString('base64'), mimeType: 'audio/webm' }, { language: 'en-US' });
    expect(text).toBe('run the checkout feature');
    expect(seen!.url).toContain(`https://${REGION}.stt.speech.microsoft.com`);
    expect(seen!.url).toContain('language=en-US');
    expect(seen!.headers['Ocp-Apim-Subscription-Key']).toBe(KEY);
    expect(seen!.headers['Content-Type']).toBe('audio/webm');
  });

  it('synthesizes: posts SSML to the TTS endpoint, returns base64 mp3', async () => {
    let seenBody = '';
    const http: VoiceHttp = vi.fn(async (_url, init) => {
      seenBody = String(init.body);
      return okAudio(new Uint8Array([1, 2, 3, 4]));
    });
    const voice = new AzureVoice({ apiKey: KEY, region: REGION, http });
    const { audio } = await voice.synthesize('Zeus & <friends>', { voice: 'en-US-JennyNeural' });
    expect(audio.mimeType).toBe('audio/mpeg');
    expect(Buffer.from(audio.data, 'base64')).toEqual(Buffer.from([1, 2, 3, 4]));
    // SSML is well-formed and XML-escaped (no raw & or <).
    expect(seenBody).toContain('<speak');
    expect(seenBody).toContain('Zeus &amp; &lt;friends&gt;');
    expect(seenBody).toContain("name='en-US-JennyNeural'");
  });

  it('scrubs the subscription key from any surfaced error (never leaks the secret)', async () => {
    const http: VoiceHttp = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      // Simulate a body that (pathologically) echoes the key — it must be scrubbed.
      text: async () => `Unauthorized for key ${KEY}`,
    });
    const voice = new AzureVoice({ apiKey: KEY, region: REGION, http });
    await expect(voice.transcribe({ data: 'AAAA', mimeType: 'audio/webm' })).rejects.toMatchObject({
      name: 'AzureVoiceError',
      status: 401,
    });
    try {
      await voice.transcribe({ data: 'AAAA', mimeType: 'audio/webm' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AzureVoiceError);
      expect((e as Error).message).not.toContain(KEY);
      expect((e as Error).message).toContain('[redacted]');
    }
  });

  it('scrubs the key from a transport (network) error too, and has no cause chaining', async () => {
    const http: VoiceHttp = async () => {
      throw new Error(`socket hang up talking to ${KEY}`);
    };
    const voice = new AzureVoice({ apiKey: KEY, region: REGION, http });
    try {
      await voice.synthesize('hi');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY);
      expect((e as { cause?: unknown }).cause).toBeUndefined();
    }
  });
});

describe('voiceFromEnv selector (AC-VOICE-05: unconfigured → stub, never 500)', () => {
  it('VOICE_MODE=offline → the deterministic stub even with a key set', () => {
    const v = voiceFromEnv({ VOICE_MODE: 'offline', AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: REGION } as NodeJS.ProcessEnv);
    expect(v).toBeInstanceOf(DeterministicVoice);
    expect(resolveVoiceMode({ VOICE_MODE: 'offline', AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: REGION } as NodeJS.ProcessEnv)).toBe('offline');
  });

  it('missing key OR missing region → the stub (never the Azure adapter)', () => {
    expect(voiceFromEnv({} as NodeJS.ProcessEnv)).toBeInstanceOf(DeterministicVoice);
    expect(voiceFromEnv({ AZURE_SPEECH_KEY: KEY } as NodeJS.ProcessEnv)).toBeInstanceOf(DeterministicVoice);
    expect(voiceFromEnv({ AZURE_SPEECH_REGION: REGION } as NodeJS.ProcessEnv)).toBeInstanceOf(DeterministicVoice);
    expect(resolveVoiceMode({} as NodeJS.ProcessEnv)).toBe('offline');
  });

  it('both key + region set and VOICE_MODE not offline → the Azure adapter', () => {
    const v = voiceFromEnv({ AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: REGION } as NodeJS.ProcessEnv);
    expect(v).toBeInstanceOf(AzureVoice);
    expect(resolveVoiceMode({ AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: REGION } as NodeJS.ProcessEnv)).toBe('azure');
  });
});
