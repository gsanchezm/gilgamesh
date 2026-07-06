import type { EmbeddingKind, EmbedWithUsageResult, KindAwareEmbeddingBrain } from '@gilgamesh/application';
import { EMBED_DIM } from '@gilgamesh/domain';

/**
 * Real semantic embeddings (slice 16, keystone v0.5): the Voyage AI embeddings API over global
 * `fetch` — no SDK dependency, unit-testable with a stubbed `fetch` (the ClaudeBrain pattern).
 * Implements the OPTIONAL S16 {@link KindAwareEmbeddingBrain} extension: Voyage distinguishes
 * `input_type` `query` (retrieval questions) vs `document` (stored corpus), and reports
 * `usage.total_tokens` which feeds EMBED metering. Bounded per call: batched inputs, timeout
 * (AbortController) and ONE retry on 429/5xx. The API key lives only in this instance and the
 * request header — it is NEVER logged, echoed in errors, or serialized.
 */

export const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';

/** Owner decision S16-1: `voyage-4` (32K context, 1024-dim default — Voyage 4 has no 1536 option). */
export const DEFAULT_VOYAGE_MODEL = 'voyage-4';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Texts per request — Voyage caps the input list and tokens per call; the full corpus re-ingest
 *  (~2,647 chunks) flows through in a couple dozen requests at this size. */
const DEFAULT_BATCH_SIZE = 128;

/** Non-2xx (or malformed) Voyage response. Status only — never the response body, never the key. */
export class VoyageApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VoyageApiError';
  }
}

export interface VoyageEmbedderOptions {
  apiKey: string;
  /** Voyage model id (env `VOYAGE_MODEL`, default `voyage-4`). */
  model?: string;
  /** Whole-call budget per batch request (default 30s). */
  timeoutMs?: number;
  /** Inputs per request (default 128). */
  batchSize?: number;
}

/** Model config from env — everything except the key (the `claudeOptionsFromEnv` pattern). */
export function voyageOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<VoyageEmbedderOptions, 'apiKey'> {
  return { model: env.VOYAGE_MODEL?.trim() || DEFAULT_VOYAGE_MODEL };
}

/**
 * The wiring seam for `brainFromEnv`: a real embedder only when `VOYAGE_API_KEY` is set AND
 * `BRAIN_MODE != offline` (spec 16 AC-EMB-03). All four test harnesses force `BRAIN_MODE=offline`,
 * so no suite can ever reach the network even on a developer machine with the key exported.
 */
export function voyageFromEnv(env: NodeJS.ProcessEnv = process.env): VoyageBrainEmbedder | undefined {
  const apiKey = env.VOYAGE_API_KEY?.trim();
  if (!apiKey || env.BRAIN_MODE === 'offline') return undefined;
  return new VoyageBrainEmbedder({ apiKey, ...voyageOptionsFromEnv(env) });
}

/** The wire shapes we consume (subset; everything else is ignored). */
interface WireEmbedding {
  embedding?: number[];
  index?: number;
}
interface WireResponse {
  data?: WireEmbedding[];
  usage?: { total_tokens?: number };
}

export class VoyageBrainEmbedder implements KindAwareEmbeddingBrain {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  constructor(options: VoyageEmbedderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_VOYAGE_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async embedAs(texts: string[], kind: EmbeddingKind): Promise<EmbedWithUsageResult> {
    const embeddings: number[][] = [];
    let totalTokens = 0;
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const json = await this.postJson({
        input: batch,
        model: this.model,
        input_type: kind,
        // The dimension is pinned EXPLICITLY to the keystone-v0.5 vector(1024) column — never left
        // to a provider default that could drift under a model override.
        output_dimension: EMBED_DIM,
      });
      // The API returns one item per input with its `index`; re-sort so vectors align with inputs.
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== batch.length) {
        throw new VoyageApiError(502, `The Voyage API returned ${data.length} embeddings for ${batch.length} inputs.`);
      }
      for (const item of data) {
        if (!Array.isArray(item.embedding) || item.embedding.length !== EMBED_DIM) {
          throw new VoyageApiError(502, `The Voyage API returned an embedding of unexpected dimension.`);
        }
        embeddings.push(item.embedding);
      }
      totalTokens += json.usage?.total_tokens ?? 0;
    }
    return { embeddings, usage: { totalTokens } };
  }

  /**
   * One POST with timeout (AbortController) and ONE retry on 429/5xx (the ClaudeBrain.request
   * pattern). The body is parsed inside the timeout budget so it covers the whole call.
   */
  private async postJson(body: Record<string, unknown>): Promise<WireResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      try {
        let res: Response;
        try {
          res = await fetch(VOYAGE_EMBEDDINGS_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (e) {
          if (controller.signal.aborted) {
            throw new VoyageApiError(408, `The Voyage request timed out after ${this.timeoutMs}ms.`);
          }
          throw e;
        }
        if (res.ok) return (await res.json()) as WireResponse;
        // Drain the failed body so undici returns the connection to the pool (review S9 pattern).
        void res.body?.cancel().catch(() => undefined);
        if ((res.status === 429 || res.status >= 500) && attempt === 0) continue;
        // Status only — never the response body (and never the key) in the error message.
        throw new VoyageApiError(res.status, `The Voyage API responded with status ${res.status}.`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
