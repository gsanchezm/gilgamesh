import { describe, expect, it } from 'vitest';

/**
 * Architecture fitness function: the domain layer is the innermost ring and must have ZERO framework
 * or outer-layer imports (Clean Architecture — dependencies point inward only). This guards the
 * project's #1 invariant against future drift; a violation fails CI rather than slipping through review.
 */
const sources = import.meta.glob('./**/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;

const FORBIDDEN: RegExp[] = [
  /^@nestjs(\/|$)/,
  /^react($|[-/])/,
  /^express(\/|$)/,
  /^@prisma(\/|$)/,
  /^argon2(\/|$)/,
  /^@gilgamesh\/(application|ui|api|web)(\/|$)/,
];

const detect = (spec: string) => FORBIDDEN.some((re) => re.test(spec));
const importsOf = (content: string) =>
  [...content.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('architecture: domain is framework-free', () => {
  it('the forbidden-import detector is not a no-op (self-check)', () => {
    expect(detect('@nestjs/common')).toBe(true);
    expect(detect('@gilgamesh/application')).toBe(true);
    expect(detect('react')).toBe(true);
    expect(detect('./errors')).toBe(false);
    expect(detect('node:crypto')).toBe(false);
    expect(detect('@gilgamesh/domain')).toBe(false);
  });

  for (const [path, content] of Object.entries(sources)) {
    if (path.includes('.test.')) continue;
    it(`${path} imports no framework/outer-layer module`, () => {
      const bad = importsOf(content).filter(detect);
      expect(bad, `disallowed imports in ${path}`).toEqual([]);
    });
  }
});
