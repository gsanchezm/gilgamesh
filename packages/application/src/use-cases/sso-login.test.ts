import { beforeEach, describe, expect, it } from 'vitest';
import { CompleteSsoLogin } from './sso-login';
import { RegisterUser } from './register-user';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';

const verified = {
  provider: 'google',
  email: 'utu@uruk.io',
  emailVerified: true,
  firstName: 'Utu',
  lastName: 'Shamash',
};

describe('CompleteSsoLogin', () => {
  let ctx: InMemoryContext;
  let sso: CompleteSsoLogin;

  beforeEach(() => {
    ctx = createInMemoryContext();
    sso = new CompleteSsoLogin(ctx);
  });

  it('registers an unknown verified email: ACTIVE user, session, isNewUser, audit auth.sso.register', async () => {
    const res = await sso.execute(verified);

    expect(res.isNewUser).toBe(true);
    expect(res.activeOrgId).toBeNull();
    const user = await ctx.users.findByEmail('utu@uruk.io');
    expect(user).toMatchObject({ firstName: 'Utu', lastName: 'Shamash', status: 'ACTIVE' });
    expect(await ctx.sessions.findByTokenHash(`th:${res.sessionToken}`)).not.toBeNull();
    const audit = ctx.audit.rows.find((r) => r.action === 'auth.sso.register');
    expect(audit).toMatchObject({ targetId: res.userId, metadata: { provider: 'google' } });
  });

  it('mints an UNUSABLE password: the hashed secret is discarded and never equals the session token', async () => {
    const res = await sso.execute(verified);
    const user = await ctx.users.findByEmail('utu@uruk.io');
    // FakePasswordHasher is transparent (`hashed:<plain>`): the hashed plain is a generated
    // token that is NOT the session token, and it never leaks into the result or the audit rows.
    expect(user!.passwordHash).toMatch(/^hashed:tok-/);
    expect(user!.passwordHash).not.toBe(`hashed:${res.sessionToken}`);
    const discarded = user!.passwordHash.slice('hashed:'.length);
    expect(JSON.stringify(res)).not.toContain(discarded);
    expect(JSON.stringify(ctx.audit.rows)).not.toContain(discarded);
  });

  it('logs in an EXISTING user (same id, no second user) and audits auth.sso.login', async () => {
    const reg = await new RegisterUser(ctx).execute({
      firstName: 'Utu',
      lastName: 'Shamash',
      email: 'utu@uruk.io',
      password: 'C0rrect-Horse!',
    });

    const res = await sso.execute(verified);
    expect(res.isNewUser).toBe(false);
    expect(res.userId).toBe(reg.userId);
    expect(ctx.audit.rows.some((r) => r.action === 'auth.sso.login')).toBe(true);
    expect(ctx.audit.rows.some((r) => r.action === 'auth.sso.register')).toBe(false);
  });

  it('normalizes the asserted email (trim + lowercase) before matching', async () => {
    const reg = await new RegisterUser(ctx).execute({
      firstName: 'Utu',
      lastName: 'Shamash',
      email: 'utu@uruk.io',
      password: 'C0rrect-Horse!',
    });
    const res = await sso.execute({ ...verified, email: '  Utu@Uruk.IO ' });
    expect(res.userId).toBe(reg.userId);
    expect(res.isNewUser).toBe(false);
  });

  it('surfaces the first membership as activeOrgId (the LoginUser contract)', async () => {
    const reg = await new RegisterUser(ctx).execute({
      firstName: 'Utu',
      lastName: 'Shamash',
      email: 'utu@uruk.io',
      password: 'C0rrect-Horse!',
    });
    await ctx.memberships.create({
      id: 'm-1',
      orgId: 'org-1',
      userId: reg.userId,
      role: 'OWNER',
      createdAt: ctx.clock.now(),
    });
    const res = await sso.execute(verified);
    expect(res.activeOrgId).toBe('org-1');
  });

  it('rejects an unverified email (FORBIDDEN): no user, no session, audited without the address', async () => {
    await expect(sso.execute({ ...verified, emailVerified: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await ctx.users.findByEmail('utu@uruk.io')).toBeNull();
    const failed = ctx.audit.rows.find((r) => r.action === 'auth.sso.failed');
    expect(failed?.metadata).toEqual({ provider: 'google', reason: 'unverified_email' });
  });

  it('rejects a DISABLED account (USER_DISABLED) without creating a session', async () => {
    const now = ctx.clock.now();
    await ctx.users.create({
      id: 'u-disabled',
      email: 'utu@uruk.io',
      passwordHash: 'hashed:whatever',
      firstName: 'U',
      middleName: null,
      lastName: 'S',
      status: 'DISABLED',
      createdAt: now,
      updatedAt: now,
    });
    await expect(sso.execute(verified)).rejects.toMatchObject({ code: 'USER_DISABLED' });
    const failed = ctx.audit.rows.find((r) => r.action === 'auth.sso.failed');
    expect(failed?.metadata).toEqual({ provider: 'google', reason: 'user_disabled' });
  });

  it('rejects a malformed asserted email as VALIDATION (never a DomainError leak)', async () => {
    await expect(sso.execute({ ...verified, email: 'not-an-email' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('falls back to email local-part / "User" when the profile has no names', async () => {
    await sso.execute({ ...verified, firstName: '  ', lastName: '' });
    const user = await ctx.users.findByEmail('utu@uruk.io');
    expect(user).toMatchObject({ firstName: 'utu', lastName: 'User' });
  });
});
