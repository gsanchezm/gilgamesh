import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER, defaultToolFor, FAMILY_COLORS } from './roster';

describe('AGENT_ROSTER', () => {
  it('has the 11 canonical deity-agents', () => {
    expect(AGENT_ROSTER).toHaveLength(11);
  });

  it('has unique slots', () => {
    expect(new Set(AGENT_ROSTER.map((a) => a.slot)).size).toBe(11);
  });

  it('matches the decided desktop roster on key slots', () => {
    const bySlot = Object.fromEntries(AGENT_ROSTER.map((a) => [a.slot, a]));
    expect(bySlot.web!.deityName).toBe('Quetzalcóatl');
    expect(bySlot.api!.deityName).toBe('Iris');
    expect(bySlot.sec!.deityName).toBe('Odin');
    expect(bySlot.a11y!.deityName).toBe('Ra');
  });

  it('defaults each role to its first tool option', () => {
    expect(defaultToolFor('web')).toBe('Playwright');
    expect(defaultToolFor('perf')).toBe('k6');
  });

  it('maps every family to a hex color', () => {
    for (const a of AGENT_ROSTER) {
      expect(FAMILY_COLORS[a.family]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
