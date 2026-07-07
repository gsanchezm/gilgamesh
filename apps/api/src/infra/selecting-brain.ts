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
  type PlatformEmbeddingStatus,
  type SecretVault,
  type UsageReportingBrain,
} from '@gilgamesh/application';
import { ClaudeBrain, claudeOptionsFromEnv } from './claude-brain';
import { VoyageBrainEmbedder, voyageFromEnv, voyageOptionsFromEnv } from './voyage-embedder';

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
 *
 * Org-voyage BYOK (S19, spec 19 AC-VBYOK-05/07): the SAME per-call discipline for embeddings —
 * the org's `voyage` Integration row → `SecretVault.get` → a per-org {@link VoyageBrainEmbedder}
 * (its own orgId+secretRef LRU cache) → else the platform Voyage embedder. Behind the COHERENCE
 * GATE (owner decision, 2026-07-06): active only when the platform space is already Voyage — the
 * org key substitutes billing/attribution within the same `voyage-4` space. Over a lexical
 * platform space (no `VOYAGE_API_KEY`) a connected org key sits vaulted but unused: embedding
 * queries with it would fork the space the stored corpus lives in (cross-space cosine is
 * garbage). Long-term fix = per-chunk embedding provenance + re-embed on connect (future slice).
 */
export type BrainMode = 'offline' | 'auto';

/** Keystone §8 AI-provider integration keys — the rows carrying an org's BYOK `secretRef`. */
const ANTHROPIC_INTEGRATION_KEY = 'anthropic';
const VOYAGE_INTEGRATION_KEY = 'voyage';
const SECRET_REF_PREFIX = 'vault://';
const DEFAULT_MAX_ORG_BRAINS = 50;

/** Call-time BYOK resolution deps: the org's integration row, the vault, and adapter factories. */
export interface OrgKeyResolution {
  integrations: Pick<IntegrationRepository, 'findByKey'>;
  vault: Pick<SecretVault, 'get'>;
  /** Builds the per-org chat adapter (S9) — injected so tests fake it and env config is applied once. */
  makeClaude?: (apiKey: string) => AgentBrainPort & UsageReportingBrain;
  /** Builds the per-org Voyage embedder (S19) — org-voyage BYOK is inert without it. */
  makeVoyage?: (apiKey: string) => KindAwareEmbeddingBrain;
  /** Per-org instance cache cap (default 50, per cache); the least-recently-used entry is evicted beyond it. */
  maxOrgBrains?: number;
}

export function resolveBrainMode(env: NodeJS.ProcessEnv = process.env): BrainMode {
  return env.BRAIN_MODE === 'offline' || !env.ANTHROPIC_API_KEY?.trim() ? 'offline' : 'auto';
}

export class SelectingBrain
  implements AgentBrainPort, UsageReportingBrain, OrgScopedBrain, KindAwareEmbeddingBrain, PlatformEmbeddingStatus
{
  /** `offline` = stub only (self-reported so the BDD sweep can assert no network path exists). */
  readonly mode: BrainMode;

  /** S16: which embedding path serves `embed`/`embedAs` — `voyage` (real semantic) or `lexical`
   *  (the deterministic domain hash). Self-reported for the same BDD-sweep reason as `mode`. */
  readonly embeddings: 'voyage' | 'lexical';

  /** [S21] Platform Voyage-space truth for the connected-but-gated UI hint: `embeddings === 'voyage'`
   *  ⇔ the platform space is live ⇔ (the S19 coherence gate) a connected org key actually embeds. */
  voyageActive(): boolean {
    return this.embeddings === 'voyage';
  }

  /** Per-org ClaudeBrain cache keyed orgId+secretRef — a rotated/removed ref naturally misses. */
  private readonly orgBrains = new Map<string, AgentBrainPort & UsageReportingBrain>();

  /** Per-org Voyage embedder cache (S19), same keying/eviction discipline as {@link orgBrains}. */
  private readonly orgVoyages = new Map<string, KindAwareEmbeddingBrain>();

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
    // Chat BYOK (S9) needs the platform Claude adapter + its factory. Voyage BYOK (S19) needs its
    // factory AND the platform Voyage embedder — the COHERENCE GATE (owner decision S19 coherence
    // gate, 2026-07-06): the stored corpus is embedded in the PLATFORM space, so an org key may
    // only substitute billing/attribution inside an already-voyage space (same model, same space).
    // Over a lexical platform space the org key must NOT embed anything: cross-space cosine is
    // garbage, and connecting a key must never silently degrade that org's search/grounding.
    const chatByok = !!(this.brains.claude && this.byok?.makeClaude);
    const voyageByok = !!(this.byok?.makeVoyage && this.brains.voyage);
    // Neither wired (offline, or no resolution deps): this instance IS the right path — returning
    // `this` keeps determinism and the BDD fault-injection seam (tests patch `stream` on the bound brain).
    if (!chatByok && !voyageByok) return this;

    const resolve = () => this.resolveOrgBrain(orgId);
    const resolveEmbedder = () => this.resolveOrgVoyage(orgId);
    const self = this;
    const handle: AgentBrainPort & UsageReportingBrain & KindAwareEmbeddingBrain = {
      complete: async (req) => (chatByok ? (await resolve()).complete(req) : self.complete(req)),
      stream: (req) => {
        if (!chatByok) return self.stream(req); // the platform/stub path (incl. the patched seam)
        const targetP = resolve();
        return (async function* () {
          yield* (await targetP).stream(req);
        })();
      },
      // S19: embeddings resolve the org's `voyage` key at call time (org → platform → lexical).
      // Without a voyage factory they ride the PLATFORM selection — an org's ANTHROPIC key must
      // never fork the one shared embedding space the vector(1024) column represents (S16 rule).
      embed: async (texts) => {
        if (!voyageByok) return self.embed(texts);
        // The frozen embed() carries no input_type — stored-content (`document`) semantics, as in
        // the platform path above.
        return (await (await resolveEmbedder()).embedAs(texts, 'document')).embeddings;
      },
      embedAs: async (texts, kind) =>
        voyageByok ? (await resolveEmbedder()).embedAs(texts, kind) : self.embedAs(texts, kind),
      // Usage passthrough (the streamWithUsage extension) so CHAT metering keeps REAL token counts.
      streamWithUsage: (req) => {
        if (!chatByok) return self.streamWithUsage(req);
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
  private resolveOrgBrain(orgId: string): Promise<AgentBrainPort & UsageReportingBrain> {
    // Only reachable through the chatByok gate in forOrg (platform claude + factory both present).
    return this.resolveOrgProvider(orgId, {
      integrationKey: ANTHROPIC_INTEGRATION_KEY,
      platform: this.brains.claude!,
      make: this.byok!.makeClaude!,
      cache: this.orgBrains,
    });
  }

  /**
   * S19 per-call resolution (spec 19 AC-VBYOK-05): org `voyage` key → platform Voyage. Same
   * discipline as {@link resolveOrgBrain}: the row is re-read every call so a disconnect/rotation
   * bites on the very next embed.
   */
  private resolveOrgVoyage(orgId: string): Promise<KindAwareEmbeddingBrain> {
    // Only reachable through the voyageByok COHERENCE GATE in forOrg (factory + platform Voyage
    // both present) — the `?? stub` fallback is defensive, never the gated path.
    return this.resolveOrgProvider(orgId, {
      integrationKey: VOYAGE_INTEGRATION_KEY,
      platform: this.brains.voyage ?? this.brains.stub,
      make: this.byok!.makeVoyage!,
      cache: this.orgVoyages,
    });
  }

  /** The shared org→platform resolution pipeline: row re-read → LRU hit → vault read → build+cache. */
  private async resolveOrgProvider<T>(
    orgId: string,
    p: { integrationKey: string; platform: T; make: (apiKey: string) => T; cache: Map<string, T> },
  ): Promise<T> {
    const byok = this.byok!;
    const row = await byok.integrations.findByKey(orgId, p.integrationKey);
    const secretRef = row?.connected ? row.secretRef : null;
    if (!secretRef || !secretRef.startsWith(SECRET_REF_PREFIX)) return p.platform;

    const cacheKey = `${orgId}\n${secretRef}`;
    const cached = p.cache.get(cacheKey);
    if (cached) {
      // Refresh recency: Map preserves insertion order, so re-inserting makes eviction LRU-ish.
      p.cache.delete(cacheKey);
      p.cache.set(cacheKey, cached);
      return cached;
    }

    const apiKey = await byok.vault.get(secretRef.slice(SECRET_REF_PREFIX.length));
    if (!apiKey) return p.platform; // BYOK row without a vault entry → platform fallthrough (spec §12)

    const built = p.make(apiKey);
    const cap = byok.maxOrgBrains ?? DEFAULT_MAX_ORG_BRAINS;
    while (p.cache.size >= cap) {
      const oldest = p.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      p.cache.delete(oldest);
    }
    p.cache.set(cacheKey, built);
    return built;
  }
}

/**
 * The wiring entry point: resolves the mode from env and composes the stub (+ Claude when auto,
 * + the Voyage embedder when `VOYAGE_API_KEY` is set and `BRAIN_MODE != offline` — S16; note the
 * embedding selection is independent of the Anthropic key: a Voyage-only deployment gets stub chat
 * with real semantic embeddings). Pass `orgKeys` (the integrations repo + vault, from the
 * persistence wiring) to enable org-BYOK call-time resolution; per-org instances share the platform
 * model/cap config — only the key differs.
 *
 * S19 + the coherence gate (owner decision, 2026-07-06): org-voyage BYOK is wired ONLY when the
 * platform embedding space is already Voyage (`voyageFromEnv` built one — `VOYAGE_API_KEY` present
 * and not `BRAIN_MODE=offline`). The org key then substitutes billing/attribution for that org's
 * embed calls within the SAME `voyage-4` space. Without a platform key the space is lexical: a
 * connected org key is verified and vaulted (it sits ready) but is never used to embed — queries
 * must stay in the space the stored corpus lives in. Every harness/CI pins `BRAIN_MODE=offline`,
 * so no suite ever builds the factory or touches the network.
 */
export function brainFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  orgKeys?: { integrations: Pick<IntegrationRepository, 'findByKey'>; vault: Pick<SecretVault, 'get'> },
): SelectingBrain {
  const stub = new DeterministicBrain();
  const voyage = voyageFromEnv(env);
  // `voyage` present already implies BRAIN_MODE != offline; gating on it IS the coherence gate.
  const makeVoyage =
    orgKeys && voyage
      ? (apiKey: string) => new VoyageBrainEmbedder({ apiKey, ...voyageOptionsFromEnv(env) })
      : undefined;
  if (resolveBrainMode(env) === 'offline') {
    return new SelectingBrain({ stub, voyage }, orgKeys && makeVoyage ? { ...orgKeys, makeVoyage } : undefined);
  }
  const options = claudeOptionsFromEnv(env);
  return new SelectingBrain(
    { stub, claude: new ClaudeBrain({ apiKey: env.ANTHROPIC_API_KEY!.trim(), ...options }), voyage },
    orgKeys && { ...orgKeys, makeClaude: (apiKey) => new ClaudeBrain({ apiKey, ...options }), makeVoyage },
  );
}
