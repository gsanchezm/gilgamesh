import { StubEmail } from '@gilgamesh/application';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EMAIL_FROM,
  emailFromEnv,
  resolveEmailMode,
  SmtpEmail,
  SmtpEmailError,
  smtpSecretsFrom,
  type SmtpTransport,
} from '../src/infra/smtp-email';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

const SMTP_URL = 'smtps://mailer:hunter2@smtp.example.com:465';

function fakeTransport(impl?: () => Promise<unknown>): SmtpTransport & { sendMail: ReturnType<typeof vi.fn> } {
  return { sendMail: vi.fn(impl ?? (async () => ({ accepted: ['x'] }))) };
}

describe('provider selection (AC-EML-01)', () => {
  it('resolveEmailMode: EMAIL_MODE=offline forces the stub even when SMTP_URL exists', () => {
    expect(resolveEmailMode(env({ EMAIL_MODE: 'offline', SMTP_URL }))).toBe('offline');
    expect(resolveEmailMode(env())).toBe('offline'); // no URL anywhere
    expect(resolveEmailMode(env({ SMTP_URL: '   ' }))).toBe('offline'); // blank URL
    expect(resolveEmailMode(env({ SMTP_URL }))).toBe('smtp');
  });

  it('offline mode: emailFromEnv returns the recording StubEmail and never builds a transport', async () => {
    const makeTransport = vi.fn(() => fakeTransport());
    const email = emailFromEnv(env({ EMAIL_MODE: 'offline', SMTP_URL }), makeTransport);
    expect(email).toBeInstanceOf(StubEmail);
    await email.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect((email as StubEmail).sent).toEqual([{ to: 'a@b.c', subject: 's', text: 't' }]);
    expect(makeTransport).not.toHaveBeenCalled();
  });

  it('smtp mode: emailFromEnv builds the transport from the trimmed SMTP_URL and returns SmtpEmail', () => {
    const makeTransport = vi.fn(() => fakeTransport());
    const email = emailFromEnv(env({ SMTP_URL: `  ${SMTP_URL}  ` }), makeTransport);
    expect(email).toBeInstanceOf(SmtpEmail);
    expect(makeTransport).toHaveBeenCalledWith(SMTP_URL);
  });
});

describe('field mapping (AC-EML-02)', () => {
  it('maps the frozen port fields onto the nodemailer message with the default from', async () => {
    const transport = fakeTransport();
    const email = new SmtpEmail({ transport });
    await email.send({ to: 'user@example.com', subject: 'Reset your password', text: 'link…' });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: DEFAULT_EMAIL_FROM,
      to: 'user@example.com',
      subject: 'Reset your password',
      text: 'link…',
    });
  });

  it('emailFromEnv honors EMAIL_FROM (trimmed) end-to-end through the injected transport', async () => {
    const transport = fakeTransport();
    const email = emailFromEnv(env({ SMTP_URL, EMAIL_FROM: '  Ops <ops@example.com>  ' }), () => transport);
    await email.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(transport.sendMail).toHaveBeenCalledWith({ from: 'Ops <ops@example.com>', to: 'a@b.c', subject: 's', text: 't' });
  });

  it('a blank EMAIL_FROM falls back to the default', async () => {
    const transport = fakeTransport();
    const email = emailFromEnv(env({ SMTP_URL, EMAIL_FROM: '   ' }), () => transport);
    await email.send({ to: 'a@b.c', subject: 's', text: 't' });
    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: DEFAULT_EMAIL_FROM }));
  });
});

describe('credential scrubbing (AC-EML-03)', () => {
  it('smtpSecretsFrom: the full URL + the password (raw and percent-decoded) are secrets', () => {
    const url = 'smtp://apikey:p%40ss%2Fword@smtp.example.com:587';
    const secrets = smtpSecretsFrom(url);
    expect(secrets).toContain(url);
    expect(secrets).toContain('p%40ss%2Fword');
    expect(secrets).toContain('p@ss/word');
    expect(secrets).not.toContain('apikey'); // the username is not scrubbed (spec §5)
  });

  it('smtpSecretsFrom: an unparseable URL is still scrubbed as a whole string', () => {
    expect(smtpSecretsFrom('not a url at all')).toEqual(['not a url at all']);
  });

  it('a transport failure surfaces as SmtpEmailError with the URL and password redacted, no cause', async () => {
    const transport = fakeTransport(async () => {
      throw new Error(`Invalid login: 535 rejected hunter2 while connecting to ${SMTP_URL}`);
    });
    const email = emailFromEnv(env({ SMTP_URL }), () => transport);

    const err = await email.send({ to: 'a@b.c', subject: 's', text: 't' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpEmailError);
    const { message, cause } = err as SmtpEmailError;
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain(SMTP_URL);
    expect(message).toContain('[redacted]');
    expect(message).toContain('Invalid login: 535'); // the diagnostic remains useful
    expect(cause).toBeUndefined(); // chaining would smuggle the unscrubbed original into logs
  });

  it('scrubs the percent-decoded password form too', async () => {
    const url = 'smtp://mailer:p%40ssword@smtp.example.com:587';
    const transport = fakeTransport(async () => {
      throw new Error('auth failed for p@ssword');
    });
    const email = emailFromEnv(env({ SMTP_URL: url }), () => transport);
    await expect(email.send({ to: 'a@b.c', subject: 's', text: 't' })).rejects.toThrow(
      'auth failed for [redacted]',
    );
  });

  it('non-Error transport rejections are stringified and scrubbed the same way', async () => {
    const transport = fakeTransport(async () => {
      throw `string failure mentioning ${SMTP_URL}`; // eslint-disable-line no-throw-literal
    });
    const email = new SmtpEmail({ transport, redact: smtpSecretsFrom(SMTP_URL) });
    const err = await email.send({ to: 'a@b.c', subject: 's', text: 't' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmtpEmailError);
    expect((err as SmtpEmailError).message).toBe('string failure mentioning [redacted]');
  });
});
