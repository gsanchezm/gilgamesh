import { beforeEach, describe, expect, it } from 'vitest';
import { LoginUser } from './login-user';
import { RegisterUser } from './register-user';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';

const creds = {
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email: 'ishtar@uruk.io',
  password: 'C0rrect-Horse!',
};

describe('LoginUser', () => {
  let ctx: InMemoryContext;
  let login: LoginUser;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    await new RegisterUser(ctx).execute(creds);
    login = new LoginUser(ctx);
  });

  it('logs in with valid credentials (no tenant yet → activeOrgId null) and audits success', async () => {
    const res = await login.execute({ email: 'Ishtar@Uruk.io', password: 'C0rrect-Horse!' });
    expect(res.sessionToken).toMatch(/^tok-/);
    expect(res.activeOrgId).toBeNull();
    expect(await ctx.sessions.findByTokenHash(`th:${res.sessionToken}`)).not.toBeNull();
    expect(ctx.audit.rows.some((r) => r.action === 'auth.login.succeeded')).toBe(true);
  });

  it('rejects a wrong password (401) and audits the failure without the password', async () => {
    await expect(login.execute({ email: 'ishtar@uruk.io', password: 'wrong-attempt' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const failed = ctx.audit.rows.find((r) => r.action === 'auth.login.failed');
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed?.metadata)).not.toContain('wrong-attempt');
  });

  it('rejects an unknown email with the same generic error', async () => {
    await expect(login.execute({ email: 'ghost@nowhere.test', password: 'whatever-pass' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects a disabled account with USER_DISABLED (403)', async () => {
    const now = ctx.clock.now();
    await ctx.users.create({
      id: 'u-disabled',
      email: 'banned@uruk.io',
      passwordHash: 'hashed:secret-passphrase',
      firstName: 'B',
      middleName: null,
      lastName: 'D',
      status: 'DISABLED',
      createdAt: now,
      updatedAt: now,
    });
    await expect(login.execute({ email: 'banned@uruk.io', password: 'secret-passphrase' })).rejects.toMatchObject({
      code: 'USER_DISABLED',
    });
  });

  it('remember-me extends the session lifetime', async () => {
    const short = await login.execute({ email: 'ishtar@uruk.io', password: 'C0rrect-Horse!', rememberMe: false });
    const long = await login.execute({ email: 'ishtar@uruk.io', password: 'C0rrect-Horse!', rememberMe: true });
    expect(long.expiresAt.getTime()).toBeGreaterThan(short.expiresAt.getTime());
  });
});
