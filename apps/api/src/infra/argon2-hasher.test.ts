import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes a password and verifies it', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(await hasher.verify('correct horse battery', hash)).toBe(true);
    expect(await hasher.verify('wrong password', hash)).toBe(false);
  });

  it('returns false (never throws) for a malformed stored hash', async () => {
    expect(await hasher.verify('anything', 'not-a-real-hash')).toBe(false);
  });
});
