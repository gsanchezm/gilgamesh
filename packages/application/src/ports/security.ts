/** Hashes and verifies passwords (Argon2id adapter in infra). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** Mints an opaque session token and the hash to persist (we never store the raw token). */
export interface TokenGenerator {
  generate(): { token: string; tokenHash: string };
}
