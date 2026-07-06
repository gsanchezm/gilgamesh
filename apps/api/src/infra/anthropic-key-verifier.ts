import { ApplicationError, StubBrainKeyVerifier, type BrainKeyVerifier } from '@gilgamesh/application';
import { ClaudeApiError, ClaudeBrain, claudeOptionsFromEnv } from './claude-brain';
import { resolveBrainMode } from './selecting-brain';

/**
 * Real {@link BrainKeyVerifier} (slice 9, AC-BYOK-02): a minimal 1-token HAIKU `complete` ping with
 * the CANDIDATE key. 401/403 (rejected key) → VALIDATION so nothing is stored; other failures
 * (network, 5xx after retry) propagate — a provider outage must not silently accept a bad key.
 * The candidate token is used only for the probe request and NEVER logged or persisted.
 */
export class AnthropicKeyVerifier implements BrainKeyVerifier {
  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async verify(input: { key: string; token: string }): Promise<void> {
    const token = input.token.trim();
    if (!token) throw new ApplicationError('VALIDATION', 'The provider rejected the API key.');
    const probe = new ClaudeBrain({
      apiKey: token,
      maxOutputTokens: 1,
      timeoutMs: this.options.timeoutMs,
      models: claudeOptionsFromEnv().models,
    });
    try {
      await probe.complete({ tier: 'HAIKU', system: '', messages: [{ role: 'user', content: 'ping' }] });
    } catch (e) {
      // Any non-retryable 4xx from the probe means the key was rejected/malformed (review S9).
      if (e instanceof ClaudeApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        throw new ApplicationError('VALIDATION', 'The provider rejected the API key.');
      }
      throw e;
    }
  }
}

/**
 * The real 1-token ping only when the brain runs in `auto` mode (platform key present, not forced
 * offline); every offline/harness path keeps the deterministic stub verifier — no network in BDD.
 */
export function brainKeyVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): BrainKeyVerifier {
  return resolveBrainMode(env) === 'auto' ? new AnthropicKeyVerifier() : new StubBrainKeyVerifier();
}
