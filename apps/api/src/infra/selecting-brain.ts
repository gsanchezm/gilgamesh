import {
  DeterministicBrain,
  type AgentBrainPort,
  type BrainCompleteRequest,
  type BrainCompleteResult,
  type BrainStreamWithUsage,
  type UsageReportingBrain,
} from '@gilgamesh/application';
import { ClaudeBrain, claudeOptionsFromEnv } from './claude-brain';

/**
 * Provider selection (slice 9, owner decision S9-1 / spec §0-1): `BRAIN_MODE=offline` OR no
 * `ANTHROPIC_API_KEY` → the deterministic stub always answers (mode `offline`, the harness/CI
 * default — no suite ever calls the network). Otherwise mode `auto` delegates to {@link ClaudeBrain}
 * with the platform key.
 *
 * TODO(S9-1 BYOK): per-call org resolution — Integration `anthropic` secretRef → vault → org key →
 * platform key → stub — lands when the SecretVault port gains `get()` (the S6 stub vault discards
 * secrets by design, so there is nothing to read back yet). Until then `auto` always uses the
 * platform key; connect/disconnect + secretRef storage already work end to end.
 */
export type BrainMode = 'offline' | 'auto';

export function resolveBrainMode(env: NodeJS.ProcessEnv = process.env): BrainMode {
  return env.BRAIN_MODE === 'offline' || !env.ANTHROPIC_API_KEY?.trim() ? 'offline' : 'auto';
}

export class SelectingBrain implements AgentBrainPort, UsageReportingBrain {
  /** `offline` = stub only (self-reported so the BDD sweep can assert no network path exists). */
  readonly mode: BrainMode;

  constructor(private readonly brains: { stub: DeterministicBrain; claude?: ClaudeBrain }) {
    this.mode = brains.claude ? 'auto' : 'offline';
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

  embed(texts: string[]): Promise<number[][]> {
    return this.target().embed(texts);
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
}

/** The wiring entry point: resolves the mode from env and composes the stub (+ Claude when auto). */
export function brainFromEnv(env: NodeJS.ProcessEnv = process.env): SelectingBrain {
  const stub = new DeterministicBrain();
  if (resolveBrainMode(env) === 'offline') return new SelectingBrain({ stub });
  return new SelectingBrain({
    stub,
    claude: new ClaudeBrain({ apiKey: env.ANTHROPIC_API_KEY!.trim(), ...claudeOptionsFromEnv(env) }),
  });
}
