import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import {
  CreateTestCase,
  DeleteTestCase,
  GetTestCase,
  ListTestCases,
  UpdateTestCase,
} from './testlab-testcases';

describe('Test Lab — test case authoring', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const onboarded = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'TRADITIONAL' });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  it('creates a test case with an auto key, NOTRUN status, and audits it (AC-TC-01)', async () => {
    const tc = await new CreateTestCase(ctx).execute({
      userId,
      projectId,
      title: 'Pay with card',
      steps: '1. open cart',
      priority: 'HIGH',
    });
    expect(tc).toMatchObject({ title: 'Pay with card', priority: 'HIGH', status: 'NOTRUN' });
    expect(tc.key).toMatch(/^TC_PRJ_\d{3}$/);
    expect(ctx.audit.rows.some((r) => r.action === 'testcase.created')).toBe(true);
  });

  it('numbers keys monotonically within the project (AC-TC-01)', async () => {
    const a = await new CreateTestCase(ctx).execute({ userId, projectId, title: 'A', priority: 'LOW' });
    const b = await new CreateTestCase(ctx).execute({ userId, projectId, title: 'B', priority: 'LOW' });
    expect(a.key).toBe('TC_PRJ_001');
    expect(b.key).toBe('TC_PRJ_002');
  });

  it('lists, reads, updates and deletes (AC-TC-02/03)', async () => {
    const created = await new CreateTestCase(ctx).execute({ userId, projectId, title: 'A', priority: 'LOW' });
    expect((await new ListTestCases(ctx).execute({ userId, projectId })).map((t) => t.id)).toEqual([created.id]);

    const updated = await new UpdateTestCase(ctx).execute({ userId, testCaseId: created.id, title: 'A2', priority: 'HIGH' });
    expect(updated).toMatchObject({ title: 'A2', priority: 'HIGH' });
    expect((await new GetTestCase(ctx).execute({ userId, testCaseId: created.id })).title).toBe('A2');

    await new DeleteTestCase(ctx).execute({ userId, testCaseId: created.id });
    await expect(new GetTestCase(ctx).execute({ userId, testCaseId: created.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a missing title or an invalid priority (AC-TC-04)', async () => {
    await expect(
      new CreateTestCase(ctx).execute({ userId, projectId, title: '   ', priority: 'HIGH' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      new CreateTestCase(ctx).execute({ userId, projectId, title: 'X', priority: 'URGENT' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('assigns an org agent and rejects an unknown one (AC-TC-05)', async () => {
    const agent = (await ctx.agents.listForOrg(orgId))[0]!;
    const tc = await new CreateTestCase(ctx).execute({
      userId,
      projectId,
      title: 'Assigned',
      priority: 'MEDIUM',
      assignedAgentId: agent.id,
    });
    expect(tc.assignedAgentId).toBe(agent.id);
    await expect(
      new CreateTestCase(ctx).execute({ userId, projectId, title: 'Bad', priority: 'LOW', assignedAgentId: 'nope' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('enforces tenant isolation and viewer RBAC (AC-TC-06/07)', async () => {
    const tc = await new CreateTestCase(ctx).execute({ userId, projectId, title: 'A', priority: 'LOW' });
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetTestCase(ctx).execute({ userId: outsider, testCaseId: tc.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    expect((await new ListTestCases(ctx).execute({ userId: viewer, projectId })).length).toBe(1);
    await expect(
      new CreateTestCase(ctx).execute({ userId: viewer, projectId, title: 'V', priority: 'LOW' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
