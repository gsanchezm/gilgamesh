/**
 * Pure AI-provider integration vocabulary (keystone §8, v0.3): the AI_PROVIDERS catalog. BYOK keys
 * ride the same Integration machinery as source repos — verified, vaulted as a secretRef, discarded.
 */
export type AiProviderKey = 'anthropic';

export interface AiProviderCatalogEntry {
  key: AiProviderKey;
  name: string;
}

export const AI_PROVIDER_CATALOG: AiProviderCatalogEntry[] = [{ key: 'anthropic', name: 'Anthropic (Claude)' }];

export const AI_PROVIDER_KEYS: AiProviderKey[] = AI_PROVIDER_CATALOG.map((e) => e.key);

export function isAiProviderKey(key: string): key is AiProviderKey {
  return (AI_PROVIDER_KEYS as string[]).includes(key);
}
