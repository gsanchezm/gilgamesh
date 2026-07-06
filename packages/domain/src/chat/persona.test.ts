import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '../agents/roster';
import { personaPrompt, slotFromPersonaPrompt } from './persona';

describe('personaPrompt', () => {
  it('renders the deity persona with its slot marker for every roster entry (AC-ROUTE-01)', () => {
    for (const entry of AGENT_ROSTER) {
      const prompt = personaPrompt(entry);
      expect(prompt).toContain(entry.deityName);
      expect(prompt).toContain(entry.role);
      expect(prompt).toContain(`(slot: ${entry.slot}`);
    }
  });

  it('instructs the persona to ground answers in provided context', () => {
    const prompt = personaPrompt(AGENT_ROSTER[0]!);
    expect(prompt.toLowerCase()).toContain('context');
  });
});

describe('slotFromPersonaPrompt', () => {
  it('round-trips the slot for every roster entry', () => {
    for (const entry of AGENT_ROSTER) {
      expect(slotFromPersonaPrompt(personaPrompt(entry))).toBe(entry.slot);
    }
  });

  it('returns null when no slot marker is present', () => {
    expect(slotFromPersonaPrompt('You are a helpful assistant.')).toBeNull();
  });

  it('returns null for a marker that is not a roster slot', () => {
    expect(slotFromPersonaPrompt('You are Loki (slot: chaos, family: trickster).')).toBeNull();
  });
});
