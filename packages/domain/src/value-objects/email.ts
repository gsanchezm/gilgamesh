import { DomainError } from '../errors';

// Pragmatic, conservative shape check. Deliverability is verified out-of-band.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A validated, normalized (trimmed + lowercased) email address. */
export class Email {
  private constructor(public readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > 254 || !EMAIL_RE.test(normalized)) {
      throw new DomainError(`Invalid email address: "${raw}"`);
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
