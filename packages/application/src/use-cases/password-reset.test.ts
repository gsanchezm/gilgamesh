import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInMemoryContext,
  InMemoryPasswordResetRepository,
  type InMemoryContext,
} from '../testing/in-memory';
import { LoginUser } from './login-user';
import { RegisterUser } from './register-user';
import { RequestPasswordReset, ResetPassword, RESET_TOKEN_TTL_MS } from './password-reset';

const creds = {
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email: 'ishtar@uruk.io',
  password: 'C0rrect-Horse!',
};

describe('RequestPasswordReset (AC-AUTH-10 / AC-REC-01 / AC-REC-03)', () => {
  let ctx: InMemoryContext;
  let requestReset: RequestPasswordReset;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    await new RegisterUser(ctx).execute(creds);
    requestReset = new RequestPasswordReset(ctx);
  });

  it('stores a hashed, 30-minute, unconsumed token and records the mail for an existing account', async () => {
    await requestReset.execute({ email: 'ishtar@uruk.io' });

    expect(ctx.passwordResets.rows).toHaveLength(1);
    const row = ctx.passwordResets.rows[0]!;
    expect(row.tokenHash).toMatch(/^th:/); // the fake generator's hash, never the raw token
    expect(row.usedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBe(ctx.clock.now().getTime() + RESET_TOKEN_TTL_MS);
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);

    expect(ctx.email.sent).toHaveLength(1);
    const mail = ctx.email.sent[0]!;
    expect(mail.to).toBe('ishtar@uruk.io');
    const raw = /[?&]token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
    expect(raw).toBeTruthy();
    // The mail carries the RAW token; the row carries only its hash.
    expect(row.tokenHash).toBe(`th:${raw}`);
    expect(mail.text).not.toContain(row.tokenHash);
  });

  it('audits auth.reset.requested without the token or the link', async () => {
    await requestReset.execute({ email: 'ishtar@uruk.io' });
    const entry = ctx.audit.rows.find((r) => r.action === 'auth.reset.requested');
    expect(entry).toBeDefined();
    expect(entry?.targetType).toBe('User');
    const raw = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.email.sent[0]!.text)![1]!;
    const serialized = JSON.stringify(entry?.metadata);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain('th:');
  });

  it('normalizes the email like login (trim + lowercase)', async () => {
    await requestReset.execute({ email: '  IShtar@Uruk.IO  ' });
    expect(ctx.passwordResets.rows).toHaveLength(1);
    expect(ctx.email.sent[0]?.to).toBe('ishtar@uruk.io');
  });

  it('leaves no trace for an unknown email (no row, no mail, no audit) and still resolves', async () => {
    await expect(requestReset.execute({ email: 'nobody@nowhere.test' })).resolves.toBeUndefined();
    expect(ctx.passwordResets.rows).toHaveLength(0);
    expect(ctx.email.sent).toHaveLength(0);
    expect(ctx.audit.rows.some((r) => r.action === 'auth.reset.requested')).toBe(false);
  });

  it('resolves without awaiting the email dispatch (a slow SMTP must not delay the 202)', async () => {
    // An email port whose promise NEVER settles — with a real SMTP adapter this is the
    // latency that would otherwise enumerate accounts (audit #5).
    const hangingEmail = { send: () => new Promise<void>(() => {}) };
    const slow = new RequestPasswordReset({ ...ctx, email: hangingEmail });

    const outcome = await Promise.race([
      slow.execute({ email: 'ishtar@uruk.io' }).then(() => 'resolved' as const),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 100)),
    ]);
    expect(outcome).toBe('resolved');
    // The reset row still landed even though delivery is in flight.
    expect(ctx.passwordResets.rows).toHaveLength(1);
  });

  it('swallows email dispatch failures (delivery must never signal account existence)', async () => {
    const failingEmail = { send: () => Promise.reject(new Error('smtp down')) };
    const failing = new RequestPasswordReset({ ...ctx, email: failingEmail });
    await expect(failing.execute({ email: 'ishtar@uruk.io' })).resolves.toBeUndefined();
  });

  it('performs the same token work whether or not the account exists (audit #5)', async () => {
    const generate = vi.spyOn(ctx.tokens, 'generate');
    await requestReset.execute({ email: 'ishtar@uruk.io' });
    const knownPathCalls = generate.mock.calls.length;
    expect(knownPathCalls).toBeGreaterThan(0);

    generate.mockClear();
    await requestReset.execute({ email: 'nobody@nowhere.test' });
    expect(generate.mock.calls.length).toBe(knownPathCalls);
  });

  it('mints nothing for a DISABLED account (a reset must not resurrect it)', async () => {
    const now = ctx.clock.now();
    await ctx.users.create({
      id: 'u-disabled',
      email: 'banned@uruk.io',
      passwordHash: 'hashed:whatever-pass',
      firstName: 'B',
      middleName: null,
      lastName: 'D',
      status: 'DISABLED',
      createdAt: now,
      updatedAt: now,
    });
    await requestReset.execute({ email: 'banned@uruk.io' });
    expect(ctx.passwordResets.rows).toHaveLength(0);
    expect(ctx.email.sent).toHaveLength(0);
  });
});

describe('ResetPassword (AC-AUTH-11 / AC-AUTH-12 / AC-REC-02 / AC-REC-04)', () => {
  let ctx: InMemoryContext;
  let reset: ResetPassword;
  let rawToken: string;
  let userId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    const registered = await new RegisterUser(ctx).execute(creds);
    userId = registered.userId;
    // A second live session (AC-AUTH-11 revokes ALL of them).
    await new LoginUser(ctx).execute({ email: creds.email, password: creds.password });
    await new RequestPasswordReset(ctx).execute({ email: creds.email });
    rawToken = /[?&]token=([A-Za-z0-9_-]+)/.exec(ctx.email.sent[0]!.text)![1]!;
    reset = new ResetPassword(ctx);
  });

  it('sets the new hash, revokes every session, consumes the token, audits completion', async () => {
    await reset.execute({ token: rawToken, newPassword: 'N3w-Passphrase!!' });

    const user = await ctx.users.findById(userId);
    expect(user?.passwordHash).toBe('hashed:N3w-Passphrase!!');
    expect(user?.updatedAt.getTime()).toBe(ctx.clock.now().getTime());

    // Both sessions (register + login) are dead.
    expect(await ctx.sessions.findByTokenHash('th:tok-1')).toMatchObject({ revokedAt: expect.any(Date) });
    expect(await ctx.sessions.findByTokenHash('th:tok-2')).toMatchObject({ revokedAt: expect.any(Date) });

    expect(ctx.passwordResets.rows[0]?.usedAt).toEqual(ctx.clock.now());

    const entry = ctx.audit.rows.find((r) => r.action === 'auth.reset.completed');
    expect(entry).toBeDefined();
    expect(entry?.targetId).toBe(userId);
    const serialized = JSON.stringify(entry?.metadata);
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toContain('N3w-Passphrase!!');
  });

  it('rejects a consumed token on reuse (single-use) and keeps the reset password', async () => {
    await reset.execute({ token: rawToken, newPassword: 'N3w-Passphrase!!' });
    await expect(reset.execute({ token: rawToken, newPassword: '0ther-Passphrase!' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const user = await ctx.users.findById(userId);
    expect(user?.passwordHash).toBe('hashed:N3w-Passphrase!!');
  });

  it('rejects an expired token (past the 30-minute TTL) and leaves the password unchanged', async () => {
    ctx.clock.advance(RESET_TOKEN_TTL_MS + 1);
    await expect(reset.execute({ token: rawToken, newPassword: 'N3w-Passphrase!!' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const user = await ctx.users.findById(userId);
    expect(user?.passwordHash).toBe(`hashed:${creds.password}`);
  });

  it('rejects an unrecognized token', async () => {
    await expect(reset.execute({ token: 'garbage-token', newPassword: 'N3w-Passphrase!!' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
    const user = await ctx.users.findById(userId);
    expect(user?.passwordHash).toBe(`hashed:${creds.password}`);
  });

  it('rejects a weak new password WITHOUT consuming the token (AC-REC-04)', async () => {
    await expect(reset.execute({ token: rawToken, newPassword: 'short' })).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
    expect(ctx.passwordResets.rows[0]?.usedAt).toBeNull();
    const user = await ctx.users.findById(userId);
    expect(user?.passwordHash).toBe(`hashed:${creds.password}`);
    // The still-valid token works afterwards.
    await reset.execute({ token: rawToken, newPassword: 'N3w-Passphrase!!' });
  });

  it('never revokes sessions or audits on a failed reset', async () => {
    await expect(reset.execute({ token: 'garbage-token', newPassword: 'N3w-Passphrase!!' })).rejects.toBeTruthy();
    expect(await ctx.sessions.findByTokenHash('th:tok-1')).toMatchObject({ revokedAt: null });
    expect(ctx.audit.rows.some((r) => r.action === 'auth.reset.completed')).toBe(false);
  });

  it('a concurrent double-submit consumes the token exactly once (atomic claim, audit #6)', async () => {
    const results = await Promise.allSettled([
      reset.execute({ token: rawToken, newPassword: 'N3w-Passphrase!!' }),
      reset.execute({ token: rawToken, newPassword: '0ther-Passphrase!' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser gets the SAME generic error as any invalid token — no oracle for the race.
    expect(rejected[0]!.reason).toMatchObject({ code: 'VALIDATION' });

    // Exactly one of the two candidate passwords landed, and completion was audited once.
    const user = await ctx.users.findById(userId);
    expect(['hashed:N3w-Passphrase!!', 'hashed:0ther-Passphrase!']).toContain(user?.passwordHash);
    expect(ctx.audit.rows.filter((r) => r.action === 'auth.reset.completed')).toHaveLength(1);
  });
});

describe('InMemoryPasswordResetRepository.claimUnused (conditional single-use claim)', () => {
  const rec = (id: string) => ({
    id,
    userId: 'u-1',
    tokenHash: `th:${id}`,
    expiresAt: new Date('2026-06-29T12:30:00.000Z'),
    usedAt: null,
    createdAt: new Date('2026-06-29T12:00:00.000Z'),
  });

  it('returns true only for the first claim and never overwrites usedAt', async () => {
    const repo = new InMemoryPasswordResetRepository();
    await repo.create(rec('pr-1'));
    const first = new Date('2026-06-29T12:05:00.000Z');

    expect(await repo.claimUnused('pr-1', first)).toBe(true);
    expect(await repo.claimUnused('pr-1', new Date(first.getTime() + 60_000))).toBe(false);
    expect(repo.rows[0]!.usedAt).toEqual(first);
  });

  it('returns false for a missing row', async () => {
    const repo = new InMemoryPasswordResetRepository();
    expect(await repo.claimUnused('nope', new Date())).toBe(false);
  });
});
