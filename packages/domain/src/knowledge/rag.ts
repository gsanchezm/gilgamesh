/**
 * Pure RAG primitives (Clean Architecture — no framework imports): corpus cleaning + a deterministic,
 * offline lexical-hash embedder + cosine similarity. The embedder is a STUB (bag-of-words hashing, real
 * lexical signal but not semantic) so the Knowledge slice's ingest/search/grounding pipeline is fully
 * testable without a model/network; the real semantic embeddings drop in behind `AgentBrainPort.embed`
 * in the Brain slice.
 */
export const EMBED_DIM = 1536;
/** Hard cap on text fed to the embedder — real chunks are < ~4 KB; this bounds hashing work on any
 *  pathologically long input (e.g. a giant search query), so iteration is never user-unbounded. */
export const MAX_EMBED_CHARS = 20_000;

const FURNITURE: RegExp[] = [
  /Page\s+\d+\s+of\s+\d+/gi, // running page footers
  /©\s*International Software Testing Qualifications Board[^\n]*/gi,
  /©\s*ISTQB[^\n]*/gi,
];

/** Removes PDF page-furniture (running headers/footers, ISTQB copyright) and normalizes whitespace/<br>. */
export function scrubChunk(text: string): string {
  // Normalize <br>→newline FIRST so the `[^\n]*`-anchored furniture regexes below can't greedily eat
  // through a literal <br> into real following text.
  let out = text.replace(/<br\s*\/?>/gi, '\n');
  for (const re of FURNITURE) out = out.replace(re, ' ');
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Max chars hashed per token — real tokens are < ~100 chars; bounds the loop so a pathologically long
 *  token can't drive unbounded iteration (CodeQL js/loop-bound-injection). */
const FNV_MAX_CHARS = 4096;

/** FNV-1a 32-bit hash — deterministic, no Date/Math.random; iteration bounded by FNV_MAX_CHARS. */
function fnv1a(s: string): number {
  let h = 2166136261;
  const len = s.length < FNV_MAX_CHARS ? s.length : FNV_MAX_CHARS;
  for (let i = 0; i < len; i++) {
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
  // Bound the work so a pathologically long input can't drive unbounded token hashing (DoS).
  const src = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
  const tokens = src.toLowerCase().match(/[a-z0-9]+/g) ?? [];
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
