import { ApplicationError, type BrainKeyVerifier } from '@gilgamesh/application';
import { VoyageApiError, VoyageBrainEmbedder, voyageOptionsFromEnv } from './voyage-embedder';

/**
 * Real Voyage {@link BrainKeyVerifier} (slice 19, AC-VBYOK-06 — the AnthropicKeyVerifier pattern):
 * ONE minimal embed ping with the CANDIDATE key. A non-retryable 4xx (rejected/malformed key) →
 * VALIDATION so nothing is stored; anything else — timeout (408), throttling (429), 5xx after the
 * embedder's single retry, network — propagates: a provider outage must never silently accept a
 * bad key. The candidate token is used only for the probe request and NEVER logged or persisted.
 */
export class VoyageKeyVerifier implements BrainKeyVerifier {
  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async verify(input: { key: string; token: string }): Promise<void> {
    const token = input.token.trim();
    if (!token) throw new ApplicationError('VALIDATION', 'The provider rejected the API key.');
    const probe = new VoyageBrainEmbedder({
      apiKey: token,
      timeoutMs: this.options.timeoutMs,
      ...voyageOptionsFromEnv(),
    });
    try {
      await probe.embedAs(['ping'], 'query');
    } catch (e) {
      // 408 is the embedder's timeout signal and 429 is throttling — neither proves a bad key.
      if (e instanceof VoyageApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        throw new ApplicationError('VALIDATION', 'The provider rejected the API key.');
      }
      throw e;
    }
  }
}

/**
 * Frozen-port dispatch on the integration key (S19): the frozen `verify({key, token})` already
 * carries the §8 provider key, so one bound verifier can route `voyage` to the Voyage ping while
 * everything else keeps the S9 anthropic selection. Composed by `brainKeyVerifierFromEnv`.
 */
export class RoutingBrainKeyVerifier implements BrainKeyVerifier {
  constructor(
    private readonly byKey: Record<string, BrainKeyVerifier>,
    private readonly fallback: BrainKeyVerifier,
  ) {}

  verify(input: { key: string; token: string }): Promise<void> {
    return (this.byKey[input.key] ?? this.fallback).verify(input);
  }
}
