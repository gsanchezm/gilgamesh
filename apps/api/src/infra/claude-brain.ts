import type {
  AgentBrainPort,
  BrainCompleteRequest,
  BrainCompleteResult,
  BrainStreamWithUsage,
  BrainTier,
  UsageReportingBrain,
} from '@gilgamesh/application';
import { embedText } from '@gilgamesh/domain';

/**
 * Real Claude adapter behind the frozen {@link AgentBrainPort} (slice 9, owner decisions S9-1/2/6):
 * the Anthropic Messages API over global `fetch` — no SDK dependency, unit-testable with a stubbed
 * `fetch`. Bounded per call: output-token cap, timeout (AbortController) and ONE retry on 429/5xx.
 * The API key lives only in this instance and the request header — it is NEVER logged, echoed in
 * errors, or serialized.
 */

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Tier→model defaults (spec 09 §0-6); overridable per tier via `BRAIN_MODEL_<TIER>` env. */
export const DEFAULT_BRAIN_MODELS: Record<BrainTier, string> = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-5',
  OPUS: 'claude-opus-4-8',
};

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ClaudeBrainOptions {
  apiKey: string;
  models?: Partial<Record<BrainTier, string>>;
  /** `max_tokens` sent per request (env `BRAIN_MAX_OUTPUT_TOKENS`, default 1024) — bounds cost. */
  maxOutputTokens?: number;
  /** Whole-call budget incl. stream consumption (default 30s). */
  timeoutMs?: number;
}

/** Non-2xx Anthropic response. Carries the HTTP status so callers can classify (e.g. the key
 *  verifier maps 401/403 → VALIDATION). The message never contains the key or the response body. */
export class ClaudeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeApiError';
  }
}

/** Model/cap config from env (spec 09 §13 config env vars) — everything except the key. */
export function claudeOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<ClaudeBrainOptions, 'apiKey'> {
  const cap = Number(env.BRAIN_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS);
  return {
    models: {
      HAIKU: env.BRAIN_MODEL_HAIKU?.trim() || DEFAULT_BRAIN_MODELS.HAIKU,
      SONNET: env.BRAIN_MODEL_SONNET?.trim() || DEFAULT_BRAIN_MODELS.SONNET,
      OPUS: env.BRAIN_MODEL_OPUS?.trim() || DEFAULT_BRAIN_MODELS.OPUS,
    },
    maxOutputTokens: Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

interface SseFrame {
  event: string;
  data: string;
}

/** The wire shapes we consume from the Messages API (subset; everything else is ignored). */
interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface WireStreamEvent {
  type?: string;
  message?: { usage?: WireUsage };
  delta?: { type?: string; text?: string };
  usage?: WireUsage;
  error?: { type?: string };
}

/** Normalizes a fetch body (web ReadableStream, async iterable, or a plain string in tests). */
async function* chunksOf(body: unknown): AsyncGenerator<Uint8Array | string> {
  if (body == null) return;
  if (typeof body === 'string') {
    yield body;
    return;
  }
  const iterable = body as { [Symbol.asyncIterator]?: unknown; getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }> } };
  if (typeof iterable[Symbol.asyncIterator] === 'function') {
    yield* body as AsyncIterable<Uint8Array | string>;
    return;
  }
  if (typeof iterable.getReader === 'function') {
    const reader = iterable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  }
}

/** Minimal SSE parser: `event:`/`data:` lines, frames separated by a blank line. */
async function* sseFrames(body: unknown): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  for await (const chunk of chunksOf(body)) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (data.length > 0) yield { event, data: data.join('\n') };
        event = '';
        data = [];
      } else if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice('data:'.length).trimStart());
      }
    }
  }
  if (data.length > 0) yield { event, data: data.join('\n') };
}

export class ClaudeBrain implements AgentBrainPort, UsageReportingBrain {
  private readonly apiKey: string;
  private readonly models: Record<BrainTier, string>;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(options: ClaudeBrainOptions) {
    this.apiKey = options.apiKey;
    this.models = { ...DEFAULT_BRAIN_MODELS, ...(options.models ?? {}) };
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(req: BrainCompleteRequest): Promise<BrainCompleteResult> {
    const { res, release } = await this.request(this.wireBody(req, false));
    try {
      const json = (await res.json()) as {
        content?: { type?: string; text?: string }[];
        usage?: WireUsage;
      };
      const text = (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
      return {
        text,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
          // Cached prefixes are EXCLUDED from input_tokens by the API — record them (review S9).
          cacheReadTokens: json.usage?.cache_read_input_tokens ?? 0,
          cacheCreateTokens: json.usage?.cache_creation_input_tokens ?? 0,
        },
      };
    } finally {
      release();
    }
  }

  async *stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }> {
    // The frozen port yields only deltas; the usage side-channel is dropped here (it is consumed
    // through streamWithUsage by metering callers).
    const s = this.streamWithUsage(req);
    for await (const ev of s.events) yield ev;
  }

  /** S9 §13 extension: stream deltas + the final real usage (message_start/message_delta). */
  streamWithUsage(req: BrainCompleteRequest): BrainStreamWithUsage {
    let resolveUsage!: (u: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreateTokens?: number;
    }) => void;
    let rejectUsage!: (e: unknown) => void;
    const usage = new Promise<{
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreateTokens?: number;
    }>((res, rej) => {
      resolveUsage = res;
      rejectUsage = rej;
    });
    // A consumer that fails mid-stream may never await `usage` — pre-attach a handler so its
    // rejection is never an unhandled-rejection crash (later awaits still observe it).
    usage.catch(() => undefined);

    const self = this;
    const events = (async function* () {
      const { res, release } = await self.request(self.wireBody(req, true));
      try {
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreateTokens = 0;
        for await (const frame of sseFrames(res.body)) {
          let parsed: WireStreamEvent;
          try {
            parsed = JSON.parse(frame.data) as WireStreamEvent;
          } catch {
            continue; // tolerate malformed frames
          }
          if (parsed.type === 'message_start') {
            inputTokens = parsed.message?.usage?.input_tokens ?? 0;
            cacheReadTokens = parsed.message?.usage?.cache_read_input_tokens ?? 0;
            cacheCreateTokens = parsed.message?.usage?.cache_creation_input_tokens ?? 0;
          } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { delta: parsed.delta.text ?? '' };
          } else if (parsed.type === 'message_delta') {
            outputTokens = parsed.usage?.output_tokens ?? outputTokens;
          } else if (parsed.type === 'error') {
            throw new ClaudeApiError(500, 'The Claude stream reported an error event.');
          }
        }
        resolveUsage({ inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens });
      } catch (e) {
        rejectUsage(e);
        throw e;
      } finally {
        release();
      }
    })();
    return { events, usage };
  }

  /** S9-2: Anthropic has no embeddings API — embed stays the deterministic domain lexical hash. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => embedText(t));
  }

  private wireBody(req: BrainCompleteRequest, stream: boolean): Record<string, unknown> {
    // `cacheKey` (frozen port) marks the system prompt as stable/reusable — Anthropic caching is
    // prefix-based, so we flag it with cache_control rather than sending the key itself.
    const system = req.system
      ? req.cacheKey
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
        : req.system
      : undefined;
    return {
      model: this.models[req.tier],
      max_tokens: this.maxOutputTokens,
      ...(system !== undefined ? { system } : {}),
      messages: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      ...(stream ? { stream: true } : {}),
    };
  }

  /**
   * One POST with timeout (AbortController) and ONE retry on 429/5xx. Returns the OK response plus
   * a `release` that disarms the timeout once the body has been fully consumed — so the budget
   * covers the whole call, not just the headers.
   */
  private async request(body: Record<string, unknown>): Promise<{ res: Response; release: () => void }> {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      let res: Response;
      try {
        res = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          throw new ClaudeApiError(408, `The Claude request timed out after ${this.timeoutMs}ms.`);
        }
        throw e;
      }
      if (res.ok) return { res, release: () => clearTimeout(timer) };
      clearTimeout(timer);
      // Drain the failed body so undici returns the connection to the pool (review S9).
      void res.body?.cancel().catch(() => undefined);
      if ((res.status === 429 || res.status >= 500) && attempt === 0) continue;
      // Status only — never the response body (and never the key) in the error message.
      throw new ClaudeApiError(res.status, `The Claude API responded with status ${res.status}.`);
    }
  }
}
