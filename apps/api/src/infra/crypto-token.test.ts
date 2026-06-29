import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoSessionTokenGenerator } from './crypto-token';

describe('CryptoSessionTokenGenerator', () => {
  it('mints a unique token and persists only its sha256 hash', () => {
    const gen = new CryptoSessionTokenGenerator();
    const a = gen.generate();
    const b = gen.generate();

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(a.tokenHash).toBe(createHash('sha256').update(a.token).digest('hex'));
    expect(a.tokenHash).not.toBe(a.token);
  });
});
