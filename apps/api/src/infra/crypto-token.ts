import { createHash, randomBytes } from 'node:crypto';
import type { TokenGenerator } from '@gilgamesh/application';

/** 256-bit opaque token (sessions + password resets); only its SHA-256 hash is persisted. */
export class CryptoSessionTokenGenerator implements TokenGenerator {
  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
