import type { EmailPort } from '../ports/email';

export interface RecordedEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Deterministic EmailPort stub (owner decision S12): RECORDS sent mail in-memory instead of
 * delivering, so tests (and the BDD sweep, via the TOKENS.Email DI seam) can assert dispatch
 * offline. It logs nothing — the reset link/token must never reach a server log. Real SMTP/SES
 * is a later adapter behind the same frozen §5 port.
 */
export class StubEmail implements EmailPort {
  readonly sent: RecordedEmail[] = [];

  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push({ ...input });
  }
}
