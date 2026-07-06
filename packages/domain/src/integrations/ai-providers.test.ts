import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_CATALOG, isAiProviderKey } from './ai-providers';

describe('AI provider catalog (keystone §8, v0.6)', () => {
  it('lists anthropic and voyage under AI_PROVIDERS (AC-BYOK-01, AC-VBYOK-01)', () => {
    expect(AI_PROVIDER_CATALOG).toEqual([
      { key: 'anthropic', name: 'Anthropic (Claude)' },
      { key: 'voyage', name: 'Voyage AI' },
    ]);
  });

  it('guards the key set', () => {
    expect(isAiProviderKey('anthropic')).toBe(true);
    expect(isAiProviderKey('voyage')).toBe(true);
    expect(isAiProviderKey('github')).toBe(false);
    expect(isAiProviderKey('')).toBe(false);
  });
});
