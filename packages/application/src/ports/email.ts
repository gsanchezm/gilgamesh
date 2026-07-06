/**
 * Outbound email (keystone §5, frozen signature verbatim): stub now (deterministic, records
 * in-memory — owner decision S12); real SMTP/SES later as an adapter swap.
 */
export interface EmailPort {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}
