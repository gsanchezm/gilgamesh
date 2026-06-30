import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { CreateSlice, DeleteSlice, ListSlices, UpdateSlice } from './testlab-slices';

describe('Test Lab — slice authoring', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
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
    const onboarded = await new CompleteOnboarding(ctx).execute({
      userId,
      projectName: 'OmniPizza',
      format: 'BDD',
    });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  // Onboarding seeds 5 default slices (checkout/login/catalog/payments/imported); use a fresh key.
  it('creates a slice appended after existing ones and audits it', async () => {
    const before = await new ListSlices(ctx).execute({ userId, projectId });
    const maxOrder = Math.max(...before.map((s) => s.order));
    const created = await new CreateSlice(ctx).execute({ userId, projectId, key: 'regression', name: 'Regression' });

    expect(created).toMatchObject({ key: 'regression', name: 'Regression', order: maxOrder + 1 });
    const after = await new ListSlices(ctx).execute({ userId, projectId });
    expect(after.map((s) => s.key)).toContain('regression');
    expect(ctx.audit.rows.some((r) => r.action === 'slice.created')).toBe(true);
  });

  it('rejects a duplicate key within the project (CONFLICT)', async () => {
    await new CreateSlice(ctx).execute({ userId, projectId, key: 'regression', name: 'Regression' });
    await expect(
      new CreateSlice(ctx).execute({ userId, projectId, key: 'regression', name: 'Dup' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('renames and reorders a slice, persisting the change', async () => {
    const s = await new CreateSlice(ctx).execute({ userId, projectId, key: 'regression', name: 'Regression' });
    const updated = await new UpdateSlice(ctx).execute({ userId, sliceId: s.id, name: 'Regression v2', order: 0 });
    expect(updated).toMatchObject({ name: 'Regression v2', order: 0 });

    const after = await new ListSlices(ctx).execute({ userId, projectId });
    expect(after.find((x) => x.id === s.id)?.name).toBe('Regression v2');
    expect(after[0]?.id).toBe(s.id); // reordered to the front (order 0, before the seeded 1..5)
  });

  it('deletes a slice', async () => {
    const s = await new CreateSlice(ctx).execute({ userId, projectId, key: 'regression', name: 'Regression' });
    await new DeleteSlice(ctx).execute({ userId, sliceId: s.id });
    const after = await new ListSlices(ctx).execute({ userId, projectId });
    expect(after.some((x) => x.id === s.id)).toBe(false);
  });

  it('enforces tenant isolation (another tenant gets NOT_FOUND)', async () => {
    const outsider = (
      await new RegisterUser(ctx).execute({
        firstName: 'E',
        lastName: 'X',
        email: 'eve@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
    await expect(new ListSlices(ctx).execute({ userId: outsider, projectId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      new CreateSlice(ctx).execute({ userId: outsider, projectId, key: 'x', name: 'X' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets a VIEWER read but not author (403)', async () => {
    const viewer = (
      await new RegisterUser(ctx).execute({
        firstName: 'V',
        lastName: 'R',
        email: 'viewer@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
    await ctx.memberships.create({
      id: ctx.ids.next(),
      orgId,
      userId: viewer,
      role: 'VIEWER',
      createdAt: ctx.clock.now(),
    });

    expect(Array.isArray(await new ListSlices(ctx).execute({ userId: viewer, projectId }))).toBe(true);
    await expect(
      new CreateSlice(ctx).execute({ userId: viewer, projectId, key: 'v', name: 'V' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
