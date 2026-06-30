import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Architecture fitness function: the application layer (use cases + ports + in-memory adapters/stubs)
 * depends INWARD only — on `@gilgamesh/domain` and its own ports, never on a framework (NestJS, React,
 * Express, Prisma, Argon2) or an outer ring (`@gilgamesh/ui|api|web`). Clean Architecture's dependency
 * rule, guarded against drift; a violation fails CI rather than slipping through review.
 */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsSources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

const FORBIDDEN: RegExp[] = [
  /^@nestjs(\/|$)/,
  /^react($|[-/])/,
  /^express(\/|$)/,
  /^@prisma(\/|$)/,
  /^argon2(\/|$)/,
  /^@gilgamesh\/(ui|api|web)(\/|$)/,
];

const detect = (spec: string) => FORBIDDEN.some((re) => re.test(spec));
const importsOf = (content: string) =>
  [...content.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);

describe('architecture: application depends inward only', () => {
  it('the forbidden-import detector is not a no-op (self-check)', () => {
    expect(detect('@nestjs/common')).toBe(true);
    expect(detect('@prisma/client')).toBe(true);
    expect(detect('@gilgamesh/api')).toBe(true);
    expect(detect('@gilgamesh/domain')).toBe(false);
    expect(detect('../ports/clock')).toBe(false);
    expect(detect('node:crypto')).toBe(false);
  });

  const files = tsSources(SRC_DIR);

  it('scans at least the known application source files', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of files) {
    it(`${file.slice(SRC_DIR.length + 1).replace(/\\/g, '/')} imports no framework/outer-layer module`, () => {
      const bad = importsOf(readFileSync(file, 'utf8')).filter(detect);
      expect(bad, 'disallowed imports').toEqual([]);
    });
  }
});
