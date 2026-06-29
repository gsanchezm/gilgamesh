import { beforeEach, describe, expect, it } from 'vitest';
import { RegisterUser, type RegisterUserInput } from './register-user';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';

const valid: RegisterUserInput = {
  firstName: 'Ishtar',
  lastName: 'Uruk',
  email: 'ishtar@uruk.io',
  password: 'C0rrect-Horse!',
};

describe('RegisterUser', () => {
  let ctx: InMemoryContext;
  let register: RegisterUser;

  beforeEach(() => {
    ctx = createInMemoryContext();
    register = new RegisterUser(ctx);
  });

  it('creates an ACTIVE user with no org, an auto-login session, and audits auth.register', async () => {
    const { userId, sessionToken } = await register.execute(valid);

    const user = await ctx.users.findById(userId);
    expect(user?.email).toBe('ishtar@uruk.io');
    expect(user?.status).toBe('ACTIVE');
    expect(user?.passwordHash).toBe('hashed:C0rrect-Horse!');
    expect(await ctx.memberships.listForUser(userId)).toHaveLength(0); // no tenant yet
    expect(sessionToken).toMatch(/^tok-/);
    expect(await ctx.sessions.findByTokenHash(`th:${sessionToken}`)).not.toBeNull();
    expect(ctx.audit.rows.some((r) => r.action === 'auth.register')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    await register.execute(valid);
    await expect(register.execute(valid)).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
  });

  it('audits the duplicate-registration attempt', async () => {
    await register.execute(valid);
    await expect(register.execute(valid)).rejects.toMatchObject({ code: 'EMAIL_IN_USE' });
    expect(ctx.audit.rows.some((r) => r.action === 'auth.register.duplicate')).toBe(true);
  });

  it('rejects a weak password', async () => {
    await expect(register.execute({ ...valid, password: 'short' })).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });
  });

  it('rejects an invalid email', async () => {
    await expect(register.execute({ ...valid, email: 'not-an-email' })).rejects.toThrow();
  });
});
