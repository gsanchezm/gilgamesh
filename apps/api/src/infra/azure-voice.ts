import { DeterministicVoice, type AudioInput, type AudioOutput, type VoicePort } from '@gilgamesh/application';

/**
 * Real voice adapter behind the frozen {@link VoicePort} (slice 42, owner decision S42): Azure
 * Cognitive Services Speech over the REST endpoints — STT (`.../speech/recognition/.../v1`) and TTS
 * (`.../cognitiveservices/v1`, SSML → MP3). The HTTP transport is an INJECTED seam ({@link VoiceHttp})
 * so unit tests drive a fake and NO suite ever reaches Azure; the default builds the request over the
 * global `fetch`. Bounded per call by a timeout (AbortController).
 *
 * The subscription key lives ONLY in this instance and the `Ocp-Apim-Subscription-Key` header — it
 * is NEVER logged, echoed in an error, or serialized. Any transport/HTTP failure surfaces as a fresh
 * {@link AzureVoiceError} whose message is scrubbed of the key (and carries NO `cause` chaining, the
 * S17 rule) so it can never smuggle the secret into a serializing logger.
 */

const REDACTED = '[redacted]';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STT_LANGUAGE = 'en-US';
/** Azure neural voice used when the caller passes no `voice` (region-agnostic multilingual default). */
const DEFAULT_TTS_VOICE = 'en-US-JennyNeural';
const TTS_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const TTS_MIME = 'audio/mpeg';

/** The minimal HTTP-response surface the adapter reads — the unit-test seam. */
export interface VoiceHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/** The injected transport: a `fetch`-shaped call the adapter never has to know is real. */
export type VoiceHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Uint8Array | string; signal?: AbortSignal },
) => Promise<VoiceHttpResponse>;

/** A failed voice call. NEVER constructed with `cause` — chaining the original error would smuggle
 *  its (possibly key-bearing) message into any logger that serializes error chains (S17 rule). */
export class AzureVoiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AzureVoiceError';
  }
}

export interface AzureVoiceOptions {
  apiKey: string;
  /** Azure region short name, e.g. `eastus2` (drives the STT/TTS host). */
  region: string;
  /** Default STT language (BCP-47); overridable per call. Default `en-US`. */
  language?: string;
  /** Default TTS voice; overridable per call. Default `en-US-JennyNeural`. */
  voice?: string;
  /** Whole-call budget (default 15s). */
  timeoutMs?: number;
  /** Injected transport (default global `fetch`); tests pass a fake so no suite touches Azure. */
  http?: VoiceHttp;
}

function scrub(message: string, secret: string): string {
  return secret ? message.split(secret).join(REDACTED) : message;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** XML-escape SSML text so a message with `<`/`&`/quotes can't break (or inject into) the SSML doc. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export class AzureVoice implements VoicePort {
  private readonly apiKey: string;
  private readonly region: string;
  private readonly language: string;
  private readonly voice: string;
  private readonly timeoutMs: number;
  private readonly http: VoiceHttp;

  constructor(options: AzureVoiceOptions) {
    this.apiKey = options.apiKey;
    this.region = options.region;
    this.language = options.language?.trim() || DEFAULT_STT_LANGUAGE;
    this.voice = options.voice?.trim() || DEFAULT_TTS_VOICE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = options.http ?? defaultHttp;
  }

  async transcribe(audio: AudioInput, opts?: { language?: string }): Promise<{ text: string }> {
    const language = opts?.language?.trim() || this.language;
    const url =
      `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(language)}`;
    const bytes = decodeBase64(audio.data);
    const res = await this.send('transcribe', url, {
      'Content-Type': audio.mimeType || 'audio/webm',
      Accept: 'application/json',
    }, bytes);
    const json = (await res.json().catch(() => ({}))) as { RecognitionStatus?: string; DisplayText?: string };
    // A "no speech" result is a valid, empty transcript — never an error.
    return { text: typeof json.DisplayText === 'string' ? json.DisplayText : '' };
  }

  async synthesize(text: string, opts?: { voice?: string }): Promise<{ audio: AudioOutput }> {
    const voice = opts?.voice?.trim() || this.voice;
    const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml =
      `<speak version='1.0' xml:lang='${DEFAULT_STT_LANGUAGE}'>` +
      `<voice xml:lang='${DEFAULT_STT_LANGUAGE}' name='${xmlEscape(voice)}'>${xmlEscape(text)}</voice></speak>`;
    const res = await this.send('synthesize', url, {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': TTS_OUTPUT_FORMAT,
    }, ssml);
    const buf = await res.arrayBuffer();
    return { audio: { data: Buffer.from(buf).toString('base64'), mimeType: TTS_MIME } };
  }

  /** One HTTP call with the key header + a timeout budget; non-2xx / transport error → scrubbed throw. */
  private async send(
    op: string,
    url: string,
    headers: Record<string, string>,
    body: Uint8Array | string,
  ): Promise<VoiceHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: VoiceHttpResponse;
    try {
      res = await this.http(url, {
        method: 'POST',
        headers: { ...headers, 'Ocp-Apim-Subscription-Key': this.apiKey },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      throw new AzureVoiceError(0, scrub(`Azure Speech ${op} failed: ${messageOf(e)}`, this.apiKey));
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      // Read a bounded body for diagnostics, scrubbed; the key can appear in neither header echo nor body.
      const detail = await res.text().catch(() => '');
      throw new AzureVoiceError(res.status, scrub(`Azure Speech ${op} HTTP ${res.status}: ${detail}`.slice(0, 500), this.apiKey));
    }
    return res;
  }
}

/** base64 → bytes, tolerant of an accidental `data:...;base64,` prefix from a browser MediaRecorder. */
function decodeBase64(data: string): Uint8Array {
  const comma = data.indexOf(',');
  const raw = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  return new Uint8Array(Buffer.from(raw, 'base64'));
}

/** Default transport: the global `fetch`, adapted to {@link VoiceHttpResponse}. No network until called. */
const defaultHttp: VoiceHttp = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    // A Uint8Array or string — both valid fetch bodies; cast through unknown to avoid a DOM-lib
    // BodyInit dependency (the api tsconfig has no DOM lib).
    body: init.body as unknown as string,
    signal: init.signal,
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json(),
    arrayBuffer: () => res.arrayBuffer(),
    text: () => res.text(),
  };
};

/**
 * Provider selection (slice 42, the S9-1 `resolveBrainMode` / S17 `emailFromEnv` pattern):
 * `VOICE_MODE=offline` OR a missing `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` → the deterministic
 * offline stub (mode `offline`, the harness/CI default — no suite reaches Azure). Otherwise mode
 * `azure` delivers real STT/TTS. Missing config falls back to the stub (never a 500 — AC-VOICE-05),
 * unlike the vault/SSO security inversion: voice is not a secret-at-rest hazard.
 */
export type VoiceMode = 'offline' | 'azure';

export function resolveVoiceMode(env: NodeJS.ProcessEnv = process.env): VoiceMode {
  const configured = env.AZURE_SPEECH_KEY?.trim() && env.AZURE_SPEECH_REGION?.trim();
  return env.VOICE_MODE === 'offline' || !configured ? 'offline' : 'azure';
}

/**
 * The wiring entry point (the `brainFromEnv`/`emailFromEnv` idiom): resolves the mode from env and
 * builds the stub or the Azure adapter. `http` is injectable so tests never touch the network; the
 * default builds the request over the global `fetch` lazily (no connection until the first call).
 */
export function voiceFromEnv(env: NodeJS.ProcessEnv = process.env, http?: VoiceHttp): VoicePort {
  if (resolveVoiceMode(env) === 'offline') return new DeterministicVoice();
  return new AzureVoice({
    apiKey: env.AZURE_SPEECH_KEY!.trim(),
    region: env.AZURE_SPEECH_REGION!.trim(),
    language: env.AZURE_SPEECH_LANGUAGE,
    voice: env.AZURE_SPEECH_VOICE,
    http,
  });
}
