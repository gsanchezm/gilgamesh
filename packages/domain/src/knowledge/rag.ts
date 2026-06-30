/**
 * Pure RAG primitives (Clean Architecture — no framework imports): corpus cleaning + a deterministic,
 * offline lexical-hash embedder + cosine similarity. The embedder is a STUB (bag-of-words hashing, real
 * lexical signal but not semantic) so the Knowledge slice's ingest/search/grounding pipeline is fully
 * testable without a model/network; the real semantic embeddings drop in behind `AgentBrainPort.embed`
 * in the Brain slice.
 */
export const EMBED_DIM = 1536;

const FURNITURE: RegExp[] = [
  /Page\s+\d+\s+of\s+\d+/gi, // running page footers
  /©\s*International Software Testing Qualifications Board[^\n]*/gi,
  /©\s*ISTQB[^\n]*/gi,
];

/** Removes PDF page-furniture (running headers/footers, ISTQB copyright) and normalizes whitespace/<br>. */
export function scrubChunk(text: string): string {
  let out = text;
  for (const re of FURNITURE) out = out.replace(re, ' ');
  return out
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** FNV-1a 32-bit hash — deterministic, no Date/Math.random. */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic lexical-hash embedding: each token bumps the dim it hashes to; the vector is L2-normalized
 * so cosine similarity ranks by lexical (term) overlap. Identical text → identical vector; an empty text → 0.
 */
export function embedText(text: string, dim: number = EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const idx = fnv1a(tok) % dim;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

/** Cosine similarity of two equal-length vectors; 0 if either is a zero vector. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
