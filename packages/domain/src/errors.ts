/**
 * Raised when a domain invariant is violated. Carries no framework coupling —
 * interface adapters translate it into a transport error (e.g. HTTP 422).
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
