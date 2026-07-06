/** Hashes and verifies passwords (Argon2id adapter in infra). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** Mints an opaque token and the hash to persist (we never store the raw token). */
export interface TokenGenerator {
  generate(): { token: string; tokenHash: string };
  /**
   * Hashes a PRESENTED raw token with the same digest `generate()` uses — the verification path
   * (session guard / password-reset consume). Keeps crypto out of the use cases.
   */
  hash(token: string): string;
}
