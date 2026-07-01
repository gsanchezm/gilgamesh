import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk-text';

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  \t ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('Boundary value analysis picks edges of equivalence classes.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain('Boundary value analysis');
  });

  it('splits long text into multiple chunks, each within the size limit', () => {
    const para = 'Lorem ipsum dolor sit amet. '.repeat(20).trim(); // ~540 chars
    const text = [para, para, para, para].join('\n\n'); // ~2200 chars
    const chunks = chunkText(text, { maxChars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(600);
  });

  it('does not cut a paragraph in the middle when it fits within the limit', () => {
    const a = 'First paragraph stays whole.';
    const b = 'Second paragraph also stays whole.';
    const chunks = chunkText(`${a}\n\n${b}`, { maxChars: 40 });
    // Each paragraph (< 40 chars) lands intact in its own chunk.
    expect(chunks.map((c) => c.text)).toEqual([a, b]);
  });

  it('hard-splits a single oversized paragraph', () => {
    const big = 'x'.repeat(1000);
    const chunks = chunkText(big, { maxChars: 300 });
    expect(chunks.length).toBe(4); // 300+300+300+100
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(300);
    expect(chunks.map((c) => c.text).join('')).toBe(big);
  });

  it('uses a markdown heading as the section for following chunks', () => {
    const chunks = chunkText('# Test Design\n\nEquivalence partitioning groups inputs.');
    expect(chunks[0]!.section).toBe('Test Design');
  });
});
