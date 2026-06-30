import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { requireProjectAccess } from './authz';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';

describe('requireProjectAccess (tenant isolation gate)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({
        firstName: 'I',
        lastName: 'U',
        email: 'owner@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
    projectId = (
      await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })
    ).projectId;
  });

  it('resolves the project and the caller role for a member', async () => {
    const { project, role } = await requireProjectAccess(ctx, userId, projectId);
    expect(project.id).toBe(projectId);
    expect(role).toBe('OWNER');
  });

  it('returns NOT_FOUND for an unknown project', async () => {
    await expect(requireProjectAccess(ctx, userId, 'does-not-exist')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns NOT_FOUND (never 403) for a non-member, so existence is not leaked across tenants', async () => {
    const outsider = (
      await new RegisterUser(ctx).execute({
        firstName: 'E',
        lastName: 'X',
        email: 'eve@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
    await expect(requireProjectAccess(ctx, outsider, projectId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns FORBIDDEN when an in-tenant member lacks the required role', async () => {
    await expect(requireProjectAccess(ctx, userId, projectId, ['VIEWER'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allows a member whose role is in allowedRoles', async () => {
    const { role } = await requireProjectAccess(ctx, userId, projectId, ['OWNER', 'ADMIN']);
    expect(role).toBe('OWNER');
  });
});
