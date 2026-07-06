import { AGENT_ROSTER, type AgentSlot, type RosterEntry } from '../agents/roster';

/**
 * Builds a deity's chat persona system prompt (slice 8). The `(slot: <key>, …)` marker is part of
 * the prompt contract: the deterministic stub brain reads it back via {@link slotFromPersonaPrompt}
 * to pick its canned per-slot answer, and the real Brain adapter simply inherits richer persona text.
 */
export function personaPrompt(entry: RosterEntry): string {
  return (
    `You are ${entry.deityName}, ${entry.role} of the Gilgamesh QA pantheon ` +
    `(slot: ${entry.slot}, family: ${entry.family}, culture: ${entry.culture}). ` +
    'Answer in character, concisely and practically. When reference context is provided, ground ' +
    'your answer in that context and cite its sources; never invent citations.'
  );
}

/** Extracts the roster slot from a persona prompt's `(slot: <key>` marker, or null. */
export function slotFromPersonaPrompt(prompt: string): AgentSlot | null {
  const match = /\(slot: ([a-z0-9]+)/.exec(prompt);
  if (!match) return null;
  const slot = match[1]!;
  return AGENT_ROSTER.some((e) => e.slot === slot) ? (slot as AgentSlot) : null;
}
