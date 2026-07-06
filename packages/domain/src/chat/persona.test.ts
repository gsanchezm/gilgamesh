import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '../agents/roster';
import { personaPrompt } from './persona';

describe('personaPrompt', () => {
  it('anchors every persona at "You are <deityName>," — the stable dispatch prefix (AC-ROUTE-01)', () => {
    for (const entry of AGENT_ROSTER) {
      const prompt = personaPrompt(entry);
      expect(prompt.startsWith(`You are ${entry.deityName},`)).toBe(true);
      expect(prompt).toContain(entry.role);
    }
  });

  it('carries no machine-readable slot marker (personas are prose; review S8)', () => {
    for (const entry of AGENT_ROSTER) {
      expect(personaPrompt(entry)).not.toContain('(slot:');
    }
  });

  it('instructs the persona to ground answers in provided context', () => {
    const prompt = personaPrompt(AGENT_ROSTER[0]!);
    expect(prompt.toLowerCase()).toContain('context');
  });
});
