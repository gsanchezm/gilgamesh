import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '../agents/roster';
import { isKnowledgeScope, SHARED_SCOPE } from './scope';

describe('isKnowledgeScope', () => {
  it('accepts every agent slot key (AC-RET-01)', () => {
    for (const entry of AGENT_ROSTER) {
      expect(isKnowledgeScope(entry.slot)).toBe(true);
    }
  });

  it("accepts the 'shared' marker (AC-RET-02)", () => {
    expect(isKnowledgeScope(SHARED_SCOPE)).toBe(true);
    expect(SHARED_SCOPE).toBe('shared');
  });

  it('rejects anything else (case-sensitive lowercase keys)', () => {
    expect(isKnowledgeScope('bogus')).toBe(false);
    expect(isKnowledgeScope('')).toBe(false);
    expect(isKnowledgeScope('SEC')).toBe(false);
    expect(isKnowledgeScope('Shared')).toBe(false);
  });
});
