import { describe, expect, it } from 'vitest';
import { Uuid7IdGenerator } from './uuid-id';

describe('Uuid7IdGenerator', () => {
  it('generates unique, well-formed v7 UUIDs', () => {
    const gen = new Uuid7IdGenerator();
    const a = gen.next();
    const b = gen.next();
    expect(a).not.toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
