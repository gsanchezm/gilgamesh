import { beforeEach, describe, expect, it } from 'vitest';
import { GetAgentRoom, SetAgentToolBinding, WakeAllAgents } from './agent-room';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';

describe('Agent room', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'ishtar@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    projectId = (
      await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })
    ).projectId;
  });

  it('lists 11 agents, all ACTIVE, with family-distribution KPIs', async () => {
    const view = await new GetAgentRoom(ctx).execute({ userId, projectId });
    expect(view.agents.map((a) => a.slot)).toEqual([
      'lead', 'arch', 'manual', 'web', 'api', 'android', 'ios', 'perf', 'visual', 'sec', 'a11y',
    ]);
    expect(view.kpis).toMatchObject({ total: 11, active: 11, idle: 0, busy: 0, awake: 11 });
    expect(view.kpis.byFamily).toEqual({ proceso: 3, ui: 4, backend: 2, guardian: 2 });
    expect(view.agents.every((a) => a.status === 'ACTIVE')).toBe(true);
  });

  it('sleeps an agent (IDLE), audits agent.enabled.changed, updates KPIs', async () => {
    const updated = await new SetAgentToolBinding(ctx).execute({ userId, projectId, slot: 'web', enabled: false });
    expect(updated.status).toBe('IDLE');
    expect(ctx.audit.rows.some((r) => r.action === 'agent.enabled.changed')).toBe(true);
    const view = await new GetAgentRoom(ctx).execute({ userId, projectId });
    expect(view.kpis).toMatchObject({ active: 10, idle: 1 });
  });

  it('changes a multi-tool agent tool (audits agent.tool.changed) and rejects an invalid tool', async () => {
    const updated = await new SetAgentToolBinding(ctx).execute({ userId, projectId, slot: 'web', tool: 'Cypress' });
    expect(updated.tool).toBe('Cypress');
    expect(ctx.audit.rows.some((r) => r.action === 'agent.tool.changed')).toBe(true);
    await expect(
      new SetAgentToolBinding(ctx).execute({ userId, projectId, slot: 'web', tool: 'Selenium' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL' });
  });

  it('rejects changing a single-tool agent', async () => {
    await expect(
      new SetAgentToolBinding(ctx).execute({ userId, projectId, slot: 'lead', tool: 'Strategy' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOOL' });
  });

  it('wakes all agents and audits agent.wake_all', async () => {
    await new SetAgentToolBinding(ctx).execute({ userId, projectId, slot: 'web', enabled: false });
    const res = await new WakeAllAgents(ctx).execute({ userId, projectId });
    expect(res).toEqual({ awake: 11, total: 11 });
    expect(ctx.audit.rows.some((r) => r.action === 'agent.wake_all')).toBe(true);
  });

  it('hides the project from another tenant (404)', async () => {
    const other = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await new CompleteOnboarding(ctx).execute({ userId: other, projectName: 'Acme', format: 'BDD' });
    await expect(new GetAgentRoom(ctx).execute({ userId: other, projectId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
