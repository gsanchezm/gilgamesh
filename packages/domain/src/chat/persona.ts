import type { RosterEntry } from '../agents/roster';

/**
 * Builds a deity's chat persona system prompt (slice 8). The prompt is prose — no machine-readable
 * markers (review S8). Its only structural contract is the anchor: it always starts with
 * `You are <deityName>,` — the deterministic stub dispatches on that caller-controlled prefix, and
 * the real Brain adapter simply inherits richer persona text.
 */
export function personaPrompt(entry: RosterEntry): string {
  return (
    `You are ${entry.deityName}, ${entry.role} of the Gilgamesh QA pantheon — ` +
    `${entry.family} family, culture ${entry.culture}. ` +
    'Answer in character, concisely and practically. When reference context is provided, ground ' +
    'your answer in that context and cite its sources; never invent citations.'
  );
}
