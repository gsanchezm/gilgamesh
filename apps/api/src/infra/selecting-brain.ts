import {
  DeterministicBrain,
  type AgentBrainPort,
  type BrainCompleteRequest,
  type BrainCompleteResult,
  type BrainStreamWithUsage,
  type EmbeddingKind,
  type EmbedWithUsageResult,
  type IntegrationRepository,
  type KindAwareEmbeddingBrain,
  type OrgScopedBrain,
  type SecretVault,
  type UsageReportingBrain,
} from '@gilgamesh/application';
import { ClaudeBrain, claudeOptionsFromEnv } from './claude-brain';
import { voyageFromEnv } from './voyage-embedder';

/**
 * Provider selection (slice 9, owner decision S9-1 / spec §0-1): `BRAIN_MODE=offline` OR no
 * `ANTHROPIC_API_KEY` → the deterministic stub always answers (mode `offline`, the harness/CI
 * default — no suite ever calls the network). Otherwise mode `auto` delegates to {@link ClaudeBrain}
 * with the platform key.
 *
 * Org-BYOK call-time resolution (S9 follow-up, closed): in `auto` mode the OPTIONAL `forOrg`
 * extension (spec 09 §13, the `streamWithUsage` precedent) resolves per call: the org's `anthropic`
 * Integration row → scope parsed from its `secretRef` (`vault://<scope>`) → `SecretVault.get` →
 * a per-org {@link ClaudeBrain} (LRU-ish cache keyed orgId+secretRef, so a rotated/removed ref
 * naturally misses and a disconnect bites on the very next call) → else the platform-key adapter.
 * In `offline` mode `forOrg` returns this instance (the stub path — determinism AND the BDD
 * fault-injection seam, which patches `stream` on the bound brain, are preserved). The resolved
 * API key lives only inside the built adapter — it is NEVER logged or embedded in errors.
 */
export type BrainMode = 'offline' | 'auto';

/** Keystone §8 AI-provider integration key — the row carrying an org's BYOK `secretRef`. */
const ANTHROPIC_INTEGRATION_KEY = 'anthropic';
const SECRET_REF_PREFIX = 'vault://';
const DEFAULT_MAX_ORG_BRAINS = 50;

/** Call-time BYOK resolution deps: the org's integration row, the vault, and an adapter factory. */
export interface OrgKeyResolution {
  integrations: Pick<IntegrationRepository, 'findByKey'>;
  vault: Pick<SecretVault, 'get'>;
  /** Builds the per-org adapter — injected so tests fake it and env config is applied once. */
  makeClaude: (apiKey: string) => AgentBrainPort & UsageReportingBrain;
  /** Per-org instance cache cap (default 50); the least-recently-used entry is evicted beyond it. */
  maxOrgBrains?: number;
}

export function resolveBrainMode(env: NodeJS.ProcessEnv = process.env): BrainMode {
  return env.BRAIN_MODE === 'offline' || !env.ANTHROPIC_API_KEY?.trim() ? 'offline' : 'auto';
}

export class SelectingBrain implements AgentBrainPort, UsageReportingBrain, OrgScopedBrain, KindAwareEmbeddingBrain {
  /** `offline` = stub only (self-reported so the BDD sweep can assert no network path exists). */
  readonly mode: BrainMode;

  /** S16: which embedding path serves `embed`/`embedAs` — `voyage` (real semantic) or `lexical`
   *  (the deterministic domain hash). Self-reported for the same BDD-sweep reason as `mode`. */
  readonly embeddings: 'voyage' | 'lexical';

  /** Per-org ClaudeBrain cache keyed orgId+secretRef — a rotated/removed ref naturally misses. */
  private readonly orgBrains = new Map<string, AgentBrainPort & UsageReportingBrain>();

  constructor(
    private readonly brains: { stub: DeterministicBrain; claude?: ClaudeBrain; voyage?: KindAwareEmbeddingBrain },
    private readonly byok?: OrgKeyResolution,
  ) {
    this.mode = brains.claude ? 'auto' : 'offline';
    this.embeddings = brains.voyage ? 'voyage' : 'lexical';
  }

  private target(): AgentBrainPort {
    return this.brains.claude ?? this.brains.stub;
  }

  complete(req: BrainCompleteRequest): Promise<BrainCompleteResult> {
    return this.target().complete(req);
  }

  stream(req: BrainCompleteRequest): AsyncIterable<{ delta: string }> {
    return this.target().stream(req);
  }

  async embed(texts: string[]): Promise<number[][]> {
    // S16: the frozen embed() carries no input_type — callers embed stored content by default,
    // so the Voyage path uses `document` semantics here; kind-aware callers use embedAs below.
    if (this.brains.voyage) return (await this.brains.voyage.embedAs(texts, 'document')).embeddings;
    return this.target().embed(texts);
  }

  /** S16 optional extension: Voyage when configured, else the deterministic lexical stub. */
  embedAs(texts: string[], kind: EmbeddingKind): Promise<EmbedWithUsageResult> {
    return (this.brains.voyage ?? this.brains.stub).embedAs(texts, kind);
  }

  streamWithUsage(req: BrainCompleteRequest): BrainStreamWithUsage {
    // Auto: pass through so metering gets the API's REAL token counts (incl. streamed calls).
    if (this.brains.claude) return this.brains.claude.streamWithUsage(req);

    // Offline: consume THIS instance's stream() — not the stub's streamWithUsage — so the BDD
    // fault-injection seam (patching `stream` on the bound brain) also drives the metered chat
    // path. Usage mirrors the stub's length-based accounting (input = last message, output = text).
    let resolveUsage!: (u: { inputTokens: number; outputTokens: number }) => void;
    let rejectUsage!: (e: unknown) => void;
    const usage = new Promise<{ inputTokens: number; outputTokens: number }>((res, rej) => {
      resolveUsage = res;
      rejectUsage = rej;
    });
    usage.catch(() => undefined); // a mid-stream failure must never become an unhandled rejection

    const self = this;
    const events = (async function* () {
      try {
        let text = '';
        for await (const ev of self.stream(req)) {
          text += ev.delta;
          yield ev;
        }
        const lastMessage = req.messages[req.messages.length - 1]?.content ?? '';
        resolveUsage({ inputTokens: lastMessage.length, outputTokens: text.length });
      } catch (e) {
        rejectUsage(e);
        throw e;
      }
    })();
    return { events, usage };
  }

  /**
   * The S9-follow-up OPTIONAL extension: an org-scoped brain handle. The handle is a lazy proxy —
   * every call re-resolves the integration row (so connect/disconnect/rotation take effect
   * immediately) and delegates to the per-org, platform, or stub adapter.
   */
  forOrg(orgId: string): AgentBrainPort {
    // Offline (or no resolution deps wired): this instance IS the right path — returning `this`
    // keeps determinism and the BDD fault-injection seam (tests patch `stream` on the bound brain).
    if (!this.brains.claude || !this.byok) return this;

    const resolve = () => this.resolveOrgBrain(orgId);
    const self = this;
    const handle: AgentBrainPort & UsageReportingBrain & KindAwareEmbeddingBrain = {
      complete: async (req) => (await resolve()).complete(req),
      stream: (req) => {
        const targetP = resolve();
        return (async function* () {
          yield* (await targetP).stream(req);
        })();
      },
      // S16: embeddings ride the PLATFORM selection (Voyage or lexical), never the per-org Claude
      // adapter — Voyage BYOK is out of scope and an org's Anthropic key must not fork the one
      // shared embedding space the vector(1024) column represents.
      embed: (texts) => self.embed(texts),
      embedAs: (texts, kind) => self.embedAs(texts, kind),
      // Usage passthrough (the streamWithUsage extension) so CHAT metering keeps REAL token counts.
      streamWithUsage: (req) => {
        let resolveUsage!: (u: Awaited<BrainStreamWithUsage['usage']>) => void;
        let rejectUsage!: (e: unknown) => void;
        const usage = new Promise<Awaited<BrainStreamWithUsage['usage']>>((res, rej) => {
          resolveUsage = res;
          rejectUsage = rej;
        });
        usage.catch(() => undefined); // never an unhandled rejection (same guard as above)
        const events = (async function* () {
          try {
            const s = (await resolve()).streamWithUsage(req);
            for await (const ev of s.events) yield ev;
            resolveUsage(await s.usage);
          } catch (e) {
            rejectUsage(e);
            throw e;
          }
        })();
        return { events, usage };
      },
    };
    return handle;
  }

  /**
   * Per-call resolution (spec 09 AC-BRAIN-02): org BYOK key → platform key. The integration row is
   * re-read on every call; the built adapter is cached by orgId+secretRef (LRU-ish, capped) so a
   * hit costs no vault read. The key is handed straight to the factory — never logged or thrown.
   */
  private async resolveOrgBrain(orgId: string): Promise<AgentBrainPort & UsageReportingBrain> {
    const platform = this.brains.claude!;
    const byok = this.byok!;
    const row = await byok.integrations.findByKey(orgId, ANTHROPIC_INTEGRATION_KEY);
    const secretRef = row?.connected ? row.secretRef : null;
    if (!secretRef || !secretRef.startsWith(SECRET_REF_PREFIX)) return platform;

    const cacheKey = `${orgId}\n${secretRef}`;
    const cached = this.orgBrains.get(cacheKey);
    if (cached) {
      // Refresh recency: Map preserves insertion order, so re-inserting makes eviction LRU-ish.
      this.orgBrains.delete(cacheKey);
      this.orgBrains.set(cacheKey, cached);
      return cached;
    }

    const apiKey = await byok.vault.get(secretRef.slice(SECRET_REF_PREFIX.length));
    if (!apiKey) return platform; // BYOK row without a vault entry → platform fallthrough (spec §12)

    const brain = byok.makeClaude(apiKey);
    const cap = byok.maxOrgBrains ?? DEFAULT_MAX_ORG_BRAINS;
    while (this.orgBrains.size >= cap) {
      const oldest = this.orgBrains.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.orgBrains.delete(oldest);
    }
    this.orgBrains.set(cacheKey, brain);
    return brain;
  }
}

/**
 * The wiring entry point: resolves the mode from env and composes the stub (+ Claude when auto,
 * + the Voyage embedder when `VOYAGE_API_KEY` is set and `BRAIN_MODE != offline` — S16; note the
 * embedding selection is independent of the Anthropic key: a Voyage-only deployment gets stub chat
 * with real semantic embeddings). Pass `orgKeys` (the integrations repo + vault, from the
 * persistence wiring) to enable org-BYOK call-time resolution; per-org instances share the platform
 * model/cap config — only the key differs.
 */
export function brainFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  orgKeys?: { integrations: Pick<IntegrationRepository, 'findByKey'>; vault: Pick<SecretVault, 'get'> },
): SelectingBrain {
  const stub = new DeterministicBrain();
  const voyage = voyageFromEnv(env);
  if (resolveBrainMode(env) === 'offline') return new SelectingBrain({ stub, voyage });
  const options = claudeOptionsFromEnv(env);
  return new SelectingBrain(
    { stub, claude: new ClaudeBrain({ apiKey: env.ANTHROPIC_API_KEY!.trim(), ...options }), voyage },
    orgKeys && { ...orgKeys, makeClaude: (apiKey) => new ClaudeBrain({ apiKey, ...options }) },
  );
}
