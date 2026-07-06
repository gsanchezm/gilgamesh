import { AGENT_ROSTER, type AgentSlot } from '../agents/roster';

/**
 * Keystone v0.2 `KnowledgeScope`: a chunk is visible to a single agent's retrieval (an AgentSlot
 * key) or to every agent (`shared`). A NULL scope on a chunk also means visible-to-all.
 */
export type KnowledgeScope = AgentSlot | 'shared';

export const SHARED_SCOPE = 'shared' as const;

/** Type guard for the lowercase keystone scope keys. */
export function isKnowledgeScope(value: string): value is KnowledgeScope {
  return value === SHARED_SCOPE || AGENT_ROSTER.some((e) => e.slot === value);
}
