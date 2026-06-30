import type { AgentSlot } from '@gilgamesh/domain';

/**
 * Resolves an agent's portrait URL from its slot. The filenames (`god-<slot>.png`) are the
 * canonical product portraits shipped under the web app's public assets; a future native app would
 * bundle the same files, so the slot→filename mapping is the shared contract (kept framework-agnostic
 * here — the base path is the only web-specific bit).
 */
const PORTRAIT_BASE = '/assets/agents';

export function portraitFor(slot: AgentSlot): string {
  return `${PORTRAIT_BASE}/god-${slot}.png`;
}
