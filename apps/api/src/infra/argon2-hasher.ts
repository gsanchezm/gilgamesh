import type { PasswordHasher } from '@gilgamesh/application';
import { hash, verify } from '@node-rs/argon2';

/** Argon2id password hashing (library defaults are OWASP-aligned argon2id). */
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Malformed stored hash (or dummy hash for unknown users) → not a match.
      return false;
    }
  }
}
