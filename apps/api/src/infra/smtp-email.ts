import { StubEmail, type EmailPort } from '@gilgamesh/application';
import { createTransport } from 'nodemailer';

/**
 * Real SMTP adapter behind the frozen {@link EmailPort} (slice 17, owner decision S17): nodemailer
 * over a standard `smtp(s)://` connection URL — works against any provider, incl. the SES SMTP
 * endpoint. The transport is an injected seam ({@link SmtpTransport}) so unit tests drive a fake
 * `sendMail` and the real factory builds `nodemailer.createTransport(SMTP_URL)` lazily (no
 * connection until the first send).
 *
 * `SMTP_URL` carries a password in its userinfo, so it is treated as a secret: it exists only in
 * env and inside the built transport, and every error this adapter surfaces is scrubbed against
 * the URL and its password (raw AND percent-decoded) before it can reach any log.
 */

/** RFC 5322 `From` header default (env `EMAIL_FROM` overrides). */
export const DEFAULT_EMAIL_FROM = 'Gilgamesh <no-reply@gilgamesh.local>';

const REDACTED = '[redacted]';

/** The minimal nodemailer `Transporter` surface the adapter needs — the unit-test seam. */
export interface SmtpTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** A failed dispatch. NEVER constructed with `cause` — chaining the original transport error
 *  would smuggle its unscrubbed message into any logger that serializes error chains. */
export class SmtpEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmtpEmailError';
  }
}

/** Secrets worth scrubbing from any error surfaced by an `SMTP_URL`-built transport: the full URL
 *  plus its password, raw and percent-decoded. The username is NOT scrubbed (commonly a non-secret
 *  account identifier such as `apikey`; redacting it would garble unrelated diagnostics). An
 *  unparseable URL is still scrubbed as a whole string. */
export function smtpSecretsFrom(url: string): string[] {
  const secrets = [url];
  try {
    const { password } = new URL(url);
    if (password) {
      secrets.push(password);
      try {
        const decoded = decodeURIComponent(password);
        if (decoded !== password) secrets.push(decoded);
      } catch {
        // Malformed escape in the password — the raw form is already in the list.
      }
    }
  } catch {
    // Unparseable URL — the full string is already in the list.
  }
  return secrets;
}

function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) if (secret) out = out.split(secret).join(REDACTED);
  return out;
}

export interface SmtpEmailOptions {
  transport: SmtpTransport;
  /** `From` header (env `EMAIL_FROM`); blank/undefined falls back to {@link DEFAULT_EMAIL_FROM}. */
  from?: string;
  /** Secret strings scrubbed from any transport error before it propagates. */
  redact?: string[];
}

export class SmtpEmail implements EmailPort {
  constructor(private readonly options: SmtpEmailOptions) {}

  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await this.options.transport.sendMail({
        from: this.options.from?.trim() || DEFAULT_EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      throw new SmtpEmailError(scrub(raw, this.options.redact ?? []));
    }
  }
}

/**
 * Provider selection (slice 17, the S9-1 `resolveBrainMode` pattern): `EMAIL_MODE=offline` OR a
 * missing/blank `SMTP_URL` → the slice-12 recording stub (mode `offline`, the harness/CI default —
 * no suite ever opens an SMTP connection). Otherwise mode `smtp` delivers via nodemailer.
 */
export type EmailMode = 'offline' | 'smtp';

export function resolveEmailMode(env: NodeJS.ProcessEnv = process.env): EmailMode {
  return env.EMAIL_MODE === 'offline' || !env.SMTP_URL?.trim() ? 'offline' : 'smtp';
}

/**
 * The wiring entry point (the `brainFromEnv` idiom): resolves the mode from env and builds the
 * stub or the SMTP adapter. `makeTransport` is injectable so tests never touch nodemailer; the
 * default builds the real transport from the trimmed `SMTP_URL`.
 */
export function emailFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  makeTransport: (smtpUrl: string) => SmtpTransport = (smtpUrl) => createTransport(smtpUrl),
): EmailPort {
  if (resolveEmailMode(env) === 'offline') return new StubEmail();
  const smtpUrl = env.SMTP_URL!.trim();
  return new SmtpEmail({
    transport: makeTransport(smtpUrl),
    from: env.EMAIL_FROM,
    redact: smtpSecretsFrom(smtpUrl),
  });
}
