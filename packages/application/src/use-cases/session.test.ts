import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { GetMe, LogoutUser } from './session';

describe('GetMe', () => {
  let ctx: InMemoryContext;
  let userId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({
        firstName: 'Ishtar',
        lastName: 'Uruk',
        email: 'ishtar@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
  });

  it('returns the user (no passwordHash), empty memberships and null activeOrgId before onboarding', async () => {
    const me = await new GetMe(ctx).execute({ userId });
    expect(me.user.email).toBe('ishtar@uruk.io');
    expect((me.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(me.memberships).toEqual([]);
    expect(me.activeOrgId).toBeNull();
  });

  it('embeds memberships (org + role) and the active org after onboarding', async () => {
    const { orgId } = await new CompleteOnboarding(ctx).execute({
      userId,
      projectName: 'OmniPizza',
      format: 'BDD',
    });
    const me = await new GetMe(ctx).execute({ userId });
    expect(me.activeOrgId).toBe(orgId);
    expect(me.memberships).toHaveLength(1);
    expect(me.memberships[0]!.role).toBe('OWNER');
    expect(me.memberships[0]!.org.id).toBe(orgId);
    expect(me.memberships[0]!.org.slug).toBe('omnipizza');
  });

  it('throws NOT_FOUND for an unknown user', async () => {
    await expect(new GetMe(ctx).execute({ userId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('LogoutUser', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let sessionToken: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    const res = await new RegisterUser(ctx).execute({
      firstName: 'I',
      lastName: 'U',
      email: 'ishtar@uruk.io',
      password: 'C0rrect-Horse!',
    });
    userId = res.userId;
    sessionToken = res.sessionToken;
  });

  it('revokes the current session and audits auth.logout', async () => {
    const session = await ctx.sessions.findByTokenHash(`th:${sessionToken}`);
    expect(session?.revokedAt).toBeNull();

    await new LogoutUser(ctx).execute({ userId, sessionId: session!.id });

    const after = await ctx.sessions.findByTokenHash(`th:${sessionToken}`);
    expect(after?.revokedAt).not.toBeNull();
    const logout = ctx.audit.rows.find((r) => r.action === 'auth.logout');
    expect(logout).toBeDefined();
    expect(logout?.targetType).toBe('Session');
  });
});
