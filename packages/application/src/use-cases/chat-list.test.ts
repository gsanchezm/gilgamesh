import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CreateChatSession, ListChatSessions, SendChatMessage } from './chat';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { TriggerRun } from './runs';
import { GenerateDrafts } from './testlab-generate';
import { CreateTestCase } from './testlab-testcases';

/**
 * Slice 11 — ListChatSessions (the v0.4 `GET /projects/{id}/chat` read): newest-first ordering on
 * `updatedAt` (the S8 send `touch` is what bumps it), a derived `title` from the first USER message
 * (≤ 60 chars, null when absent), one batched first-message lookup (never N+1), and the standard
 * tenant/RBAC gates.
 */
describe('Chat re-skin — ListChatSessions', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const o = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = o.orgId;
    projectId = o.projectId;
  });

  const makeSession = (pin?: string) =>
    new CreateChatSession(ctx).execute({ userId, projectId, agentId: pin });

  const send = (sessionId: string, content: string) =>
    new SendChatMessage({
      ...ctx,
      tools: {
        triggerRun: new TriggerRun(ctx),
        createTestCase: new CreateTestCase(ctx),
        generateDrafts: new GenerateDrafts(ctx),
      },
    }).execute({ userId, sessionId, content });

  const list = () => new ListChatSessions(ctx).execute({ userId, projectId });

  it('returns an empty list for a project with no sessions', async () => {
    expect(await list()).toEqual([]);
  });

  it('lists sessions newest-first by updatedAt — activity bumps a session to the top (AC-CRS-01/02)', async () => {
    const first = await makeSession();
    ctx.clock.advance(1_000);
    const second = await makeSession();
    ctx.clock.advance(1_000);

    // Creation order alone: the second session is newest.
    expect((await list()).map((s) => s.id)).toEqual([second.id, first.id]);

    // Sending into the FIRST session touches its updatedAt (S8) and bumps it to the top.
    await send(first.id, 'waking the older conversation');
    const rows = await list();
    expect(rows.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(rows[0]!.updatedAt.getTime()).toBeGreaterThan(rows[1]!.updatedAt.getTime());
  });

  it('derives the title from the first USER message, trimmed to 60 chars; null when absent (AC-CRS-01)', async () => {
    const untitled = await makeSession();
    ctx.clock.advance(1_000);
    const titled = await makeSession();
    ctx.clock.advance(1_000);
    const long = 'this question about performance budgets is deliberately far longer than sixty characters';
    await send(titled.id, `  ${long}  `);

    const rows = await list();
    const titledRow = rows.find((s) => s.id === titled.id)!;
    const untitledRow = rows.find((s) => s.id === untitled.id)!;
    expect(titledRow.title).toBe(long.slice(0, 60));
    expect(titledRow.title!.length).toBe(60);
    expect(untitledRow.title).toBeNull();
  });

  it('the title is the FIRST user message, not a later one', async () => {
    const session = await makeSession();
    await send(session.id, 'hello pantheon');
    ctx.clock.advance(1_000);
    await send(session.id, 'a follow-up question');
    expect((await list())[0]!.title).toBe('hello pantheon');
  });

  it('carries the pin: a tile-pinned session lists with its agentId (AC-CRS-06)', async () => {
    const perf = (await ctx.agents.listForOrg(orgId)).find((a) => a.slot === 'perf')!;
    await makeSession(perf.id);
    const rows = await list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentId).toBe(perf.id);
  });

  it('uses ONE batched first-message lookup for the whole list (never N+1)', async () => {
    await makeSession();
    ctx.clock.advance(10);
    await makeSession();
    ctx.clock.advance(10);
    await makeSession();
    const spy = vi.spyOn(ctx.chatMessages, 'firstUserMessageBySession');
    await list();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toHaveLength(3);
  });

  it('enforces tenant isolation + viewer RBAC (AC-CRS-04/05)', async () => {
    await makeSession();
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@nippur.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(
      new ListChatSessions(ctx).execute({ userId: outsider, projectId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(
      new ListChatSessions(ctx).execute({ userId: viewer, projectId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
