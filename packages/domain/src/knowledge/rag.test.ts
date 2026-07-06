import { describe, expect, it } from 'vitest';
import { cosineSimilarity, EMBED_DIM, embedText, MAX_EMBED_CHARS, scrubChunk } from './rag';

describe('scrubChunk', () => {
  it('strips page furniture + the ISTQB copyright line and normalizes <br>', () => {
    const dirty =
      'Equivalence partitioning Page 12 of 45 divides the input domain.<br>© International Software Testing Qualifications Board';
    const clean = scrubChunk(dirty);
    expect(clean).not.toMatch(/Page\s+\d+\s+of\s+\d+/i);
    expect(clean).not.toMatch(/International Software Testing/i);
    expect(clean).not.toContain('<br>');
    expect(clean).toContain('Equivalence partitioning');
    expect(clean).toContain('divides the input domain');
  });

  it('keeps text after a <br> that immediately follows the copyright line (scrub ordering)', () => {
    const dirty =
      'Intro. © International Software Testing Qualifications Board<br>Equivalence partitioning divides inputs.';
    const clean = scrubChunk(dirty);
    expect(clean).not.toMatch(/International Software Testing/);
    expect(clean).toContain('Equivalence partitioning divides inputs');
  });
});

describe('embedText', () => {
  it('is deterministic, text-dependent and L2-normalized (1024-dim, keystone v0.5)', () => {
    const a = embedText('example mapping discovery workshop');
    const b = embedText('example mapping discovery workshop');
    const c = embedText('performance load testing throughput');
    expect(a).toHaveLength(1024);
    expect(EMBED_DIM).toBe(1024); // Voyage voyage-4 default; Voyage 4 has no 1536 option (v0.5 BREAKING)
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
  });

  it('returns a zero vector for empty text (no NaN)', () => {
    const v = embedText('   ');
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('caps hashing work at MAX_EMBED_CHARS (bounded on hostile input)', () => {
    const huge = 'a'.repeat(MAX_EMBED_CHARS + 5000);
    const capped = 'a'.repeat(MAX_EMBED_CHARS);
    expect(embedText(huge)).toEqual(embedText(capped));
  });
});

describe('cosineSimilarity', () => {
  it('ranks lexically-overlapping text higher than unrelated text', () => {
    const q = embedText('example mapping');
    const related = embedText('example mapping is a collaborative discovery technique');
    const unrelated = embedText('performance load testing throughput latency');
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });
});
