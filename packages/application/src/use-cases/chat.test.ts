import type { KnowledgeScope } from '@gilgamesh/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentBrainPort, BrainCompleteRequest } from '../ports/brain';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CHAT_TOKEN_QUOTA_NARRATION, CreateChatSession, GetChatEvents, SendChatMessage } from './chat';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { TriggerRun } from './runs';
import { CreateFeature } from './testlab-features';
import { GenerateDrafts } from './testlab-generate';
import { CreateTestCase } from './testlab-testcases';

describe('Agent Chat — sessions, routing, retrieval, tools', () => {
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

  const agentId = async (slot: string) => (await ctx.agents.listForOrg(orgId)).find((a) => a.slot === slot)!.id;

  function makeSend(brain: AgentBrainPort = ctx.brain) {
    return new SendChatMessage({
      ...ctx,
      brain,
      tools: {
        triggerRun: new TriggerRun(ctx),
        createTestCase: new CreateTestCase(ctx),
        generateDrafts: new GenerateDrafts(ctx),
      },
    });
  }

  const makeSession = (pin?: string | null) =>
    new CreateChatSession(ctx).execute({ userId, projectId, agentId: pin ?? undefined });

  async function seedChunk(name: string, scope: KnowledgeScope | null, chunkOrgId: string | null = orgId) {
    const content = `${name}: how should we test this area — curated reference guidance.`;
    const [embedding] = await ctx.brain.embed([content]);
    await ctx.knowledge.upsertMany([
      {
        id: `kb-${name.toLowerCase()}`,
        orgId: chunkOrgId,
        documentId: null,
        source: name,
        headingPath: [name],
        section: name,
        content,
        embedding: embedding!,
        tokenEstimate: 12,
        scope,
      },
    ]);
  }

  // ---- Sessions (AC-CHAT-*) ----

  it('creates a session scoped to org+project and audits it (AC-CHAT-01)', async () => {
    const view = await makeSession();
    expect(view.projectId).toBe(projectId);
    expect(view.agentId).toBeNull();
    const row = await ctx.chatSessions.findById(view.id);
    expect(row).toMatchObject({ orgId, projectId, createdById: userId, agentId: null });
    expect(ctx.audit.rows.some((r) => r.action === 'chat.session.created')).toBe(true);
  });

  it('pins a catalog agent; rejects an unknown/foreign pin (AC-CHAT-01/05)', async () => {
    const perf = await agentId('perf');
    expect((await makeSession(perf)).agentId).toBe(perf);
    await expect(makeSession('not-a-real-agent')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('enforces tenant isolation + viewer RBAC on create/send (AC-CHAT-03/04)', async () => {
    const session = await makeSession();
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@nippur.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(
      new CreateChatSession(ctx).execute({ userId: outsider, projectId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      makeSend().execute({ userId: outsider, sessionId: session.id, content: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(new CreateChatSession(ctx).execute({ userId: viewer, projectId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      makeSend().execute({ userId: viewer, sessionId: session.id, content: 'hi' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Chat is MEMBER+ (spec §10.2): a VIEWER may not read conversations either (review S8).
    await expect(
      new GetChatEvents(ctx).execute({ userId: viewer, sessionId: session.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('persists the USER message then the AGENT answer, in order (AC-CHAT-02)', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    expect(res.message).toMatchObject({ role: 'USER', content: 'hello pantheon', runId: null });

    const rows = await ctx.chatMessages.listForSession(session.id);
    expect(rows.map((m) => m.role)).toEqual(['USER', 'AGENT']);
    expect(rows[0]!.content).toBe('hello pantheon');
    expect(rows[1]!.content.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.orgId === orgId)).toBe(true);
  });

  it('rejects an empty or oversized message (validation)', async () => {
    const session = await makeSession();
    await expect(makeSend().execute({ userId, sessionId: session.id, content: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      makeSend().execute({ userId, sessionId: session.id, content: 'x'.repeat(4001) }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- Routing (AC-ROUTE-*) ----

  it('routes a performance question to Thor (perf) via a HAIKU classify (AC-ROUTE-01)', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({
      userId,
      sessionId: session.id,
      content: 'our checkout p95 latency explodes under load',
    });
    expect(res.answer.agentId).toBe(await agentId('perf'));

    const audit = ctx.audit.rows.find((r) => r.action === 'chat.message.sent')!;
    expect(audit.metadata).toMatchObject({ routed: true, tier: 'HAIKU', slot: 'perf' });
    // Never the raw message text in the audit trail.
    expect(JSON.stringify(audit.metadata)).not.toContain('checkout p95');
  });

  it('falls back to Zeus (lead) on low confidence (AC-ROUTE-02)', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'hmm not sure, thoughts?' });
    expect(res.answer.agentId).toBe(await agentId('lead'));
    const audit = ctx.audit.rows.find((r) => r.action === 'chat.message.sent')!;
    expect(audit.metadata).toMatchObject({ slot: 'lead', fallback: true });
  });

  it('excludes a disabled agent from routing — the lead covers (AC-ROUTE-03)', async () => {
    const perf = await agentId('perf');
    const binding = (await ctx.toolBindings.findByProjectAndAgent(projectId, perf))!;
    await ctx.toolBindings.save({ ...binding, enabled: false });

    const session = await makeSession();
    const res = await makeSend().execute({
      userId,
      sessionId: session.id,
      content: 'our checkout p95 latency explodes under load',
    });
    expect(res.answer.agentId).toBe(await agentId('lead'));
  });

  it('a pinned session skips routing entirely — no HAIKU classify call (AC-ROUTE-04)', async () => {
    const calls: BrainCompleteRequest[] = [];
    const spy: AgentBrainPort = {
      complete: (req) => {
        calls.push(req);
        return ctx.brain.complete(req);
      },
      stream: (req) => ctx.brain.stream(req),
      embed: (t) => ctx.brain.embed(t),
    };
    const session = await makeSession(await agentId('sec'));
    const res = await makeSend(spy).execute({
      userId,
      sessionId: session.id,
      content: 'our checkout p95 latency explodes under load',
    });
    expect(res.answer.agentId).toBe(await agentId('sec'));
    expect(calls.filter((c) => c.tier === 'HAIKU')).toHaveLength(0);
    const audit = ctx.audit.rows.find((r) => r.action === 'chat.message.sent')!;
    expect(audit.metadata).toMatchObject({ routed: false, slot: 'sec' });
  });

  it('answers are deterministic canned responses per slot (AC-ROUTE-05)', async () => {
    const s1 = await makeSession();
    const s2 = await makeSession();
    const a = await makeSend().execute({ userId, sessionId: s1.id, content: 'load test the api endpoints' });
    const b = await makeSend().execute({ userId, sessionId: s2.id, content: 'load test the api endpoints' });
    expect(a.answer.content).toBe(b.answer.content);
  });

  // ---- Scoped retrieval (AC-RET-*) ----

  it("grounds a perf chat in perf/'shared'/NULL chunks — never a sec-scoped one (AC-RET-01/02)", async () => {
    await seedChunk('SQLI-PLAYBOOK', 'sec');
    await seedChunk('LOAD-MODEL', 'perf');
    await seedChunk('HOUSE-RULES', 'shared');
    await seedChunk('LEGACY-NOTES', null);

    const session = await makeSession(await agentId('perf'));
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'how should we test this' });
    expect(res.answer.content).toContain('LOAD-MODEL');
    expect(res.answer.content).toContain('HOUSE-RULES');
    expect(res.answer.content).toContain('LEGACY-NOTES');
    expect(res.answer.content).not.toContain('SQLI-PLAYBOOK');
  });

  it("never retrieves another org's chunks (AC-RET-03)", async () => {
    await seedChunk('NIPPUR-SECRET', 'shared', 'some-other-org');
    const session = await makeSession(await agentId('perf'));
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'how should we test this' });
    expect(res.answer.content).not.toContain('NIPPUR-SECRET');
  });

  // ---- Tool calls (AC-CRUN-*) ----

  const makeFeature = () =>
    new CreateFeature(ctx).execute({
      userId,
      projectId,
      path: 'checkout.feature',
      content: 'Feature: Checkout\n  Scenario: Checkout case 1\n    When step 1\n  Scenario: Checkout case 2\n    When step 2\n',
    });

  it('enqueue_run rides the standard TriggerRun path: run + runId link + SYSTEM summary + audit (AC-CRUN-01/03)', async () => {
    await makeFeature();
    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'run the Checkout feature' });

    const runs = await ctx.runs.listForProject(projectId);
    expect(runs).toHaveLength(1);
    // The 201 view must carry the link in BOTH wirings — never rely on in-memory object mutation (review S8).
    expect(res.message.runId).toBe(runs[0]!.id);
    expect(runs[0]).toMatchObject({ trigger: 'MANUAL', targetKind: 'FEATURE', createdById: userId });

    const rows = await ctx.chatMessages.listForSession(session.id);
    const user = rows.find((m) => m.role === 'USER')!;
    expect(user.runId).toBe(runs[0]!.id);
    const system = rows.find((m) => m.role === 'SYSTEM')!;
    expect(system.runId).toBe(runs[0]!.id);
    expect(system.content).toContain('Checkout case 1');
    expect(system.content).toMatch(/PASS|FAIL/);

    expect(ctx.audit.rows.some((r) => r.action === 'run.created')).toBe(true);
    expect(ctx.audit.rows.some((r) => r.action === 'chat.tool.invoked')).toBe(true);
  });

  it('a chat-triggered run respects the quota: no Run, narrated QUOTA_EXCEEDED (AC-CRUN-02)', async () => {
    await makeFeature();
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.save({ ...sub, runMinutesUsed: sub.runMinutesQuota });

    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'run the Checkout feature' });
    expect(res.answer.content).toContain('QUOTA_EXCEEDED');
    expect(await ctx.runs.listForProject(projectId)).toHaveLength(0);
    const rows = await ctx.chatMessages.listForSession(session.id);
    expect(rows.find((m) => m.role === 'USER')!.runId).toBeNull();
    // "Each tool call" is audited — including blocked ones (spec §9, review S8).
    const audit = ctx.audit.rows.find((r) => r.action === 'chat.tool.invoked')!;
    expect(audit.metadata).toMatchObject({ tool: 'enqueue_run', outcome: 'QUOTA_EXCEEDED' });
  });

  it('narrates gracefully when the named feature does not exist', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'run the Ghost feature' });
    expect(res.answer.content).toContain('Ghost');
    expect(await ctx.runs.listForProject(projectId)).toHaveLength(0);
  });

  it('create_test_case invokes the existing use case (persisted + audited) (AC-CRUN-04)', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({
      userId,
      sessionId: session.id,
      content: 'create a test case for cash payments',
    });
    const cases = await ctx.testCases.listForProject(projectId);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.key).toMatch(/^TC_/);
    expect(cases[0]!.title).toBe('cash payments');
    expect(res.answer.content).toContain(cases[0]!.key);
    expect(ctx.audit.rows.some((r) => r.action === 'testcase.created')).toBe(true);
  });

  it('generate_feature returns drafts for review without persisting (AC-CRUN-04)', async () => {
    const session = await makeSession();
    const res = await makeSend().execute({
      userId,
      sessionId: session.id,
      content: 'generate a feature for refunds',
    });
    expect(res.answer.content.toLowerCase()).toContain('draft');
    expect(await ctx.features.listForProject(projectId)).toHaveLength(0);
  });

  it('caps tool args at the direct endpoints\' limits: title ≤ 256, prompt ≤ 2000 (review S8)', async () => {
    const session = await makeSession();
    await makeSend().execute({
      userId,
      sessionId: session.id,
      content: `create a test case for ${'x'.repeat(3000)}`,
    });
    const cases = await ctx.testCases.listForProject(projectId);
    expect(cases[0]!.title.length).toBeLessThanOrEqual(256);

    const prompts: string[] = [];
    const spyTools = {
      triggerRun: new TriggerRun(ctx),
      createTestCase: new CreateTestCase(ctx),
      generateDrafts: {
        execute: async (i: { userId: string; projectId: string; prompt: string }) => {
          prompts.push(i.prompt);
          return new GenerateDrafts(ctx).execute(i);
        },
      },
    };
    const send = new SendChatMessage({ ...ctx, tools: spyTools });
    const s2 = await makeSession();
    await send.execute({ userId, sessionId: s2.id, content: `generate a feature ${'y'.repeat(3000)}` });
    expect(prompts[0]!.length).toBeLessThanOrEqual(2000);
  });

  it('narrates a failing authoring tool instead of failing the send (review S8)', async () => {
    const failingTools = {
      triggerRun: new TriggerRun(ctx),
      createTestCase: {
        execute: async () => {
          throw new (await import('../errors')).ApplicationError('CONFLICT', 'Key collision.');
        },
      },
      generateDrafts: new GenerateDrafts(ctx),
    };
    const send = new SendChatMessage({ ...ctx, tools: failingTools });
    const session = await makeSession();
    const res = await send.execute({ userId, sessionId: session.id, content: 'create a test case for cash' });
    expect(res.answer.content).toContain('CONFLICT');
    const rows = await ctx.chatMessages.listForSession(session.id);
    expect(rows.map((m) => m.role)).toEqual(['USER', 'AGENT']);
    const audit = ctx.audit.rows.find((r) => r.action === 'chat.tool.invoked')!;
    expect(audit.metadata).toMatchObject({ tool: 'create_test_case', outcome: 'CONFLICT' });
  });

  it('refuses a tool outside the whitelist of 3 (AC-CRUN-04)', async () => {
    const rogue: AgentBrainPort = {
      complete: async (req) =>
        req.tier === 'HAIKU'
          ? ctx.brain.complete(req)
          : { text: JSON.stringify({ tool: 'drop_database' }), usage: { inputTokens: 0, outputTokens: 0 } },
      stream: async function* (req) {
        yield { delta: (await rogue.complete(req)).text };
      },
      embed: (t) => ctx.brain.embed(t),
    };
    const session = await makeSession();
    const res = await makeSend(rogue).execute({ userId, sessionId: session.id, content: 'anything' });
    expect(res.answer.content).toContain('drop_database');
    expect(res.answer.content.toLowerCase()).toContain('not available');
    expect(ctx.audit.rows.some((r) => r.action === 'chat.tool.invoked')).toBe(false);
  });

  // ---- Slice 9: brain resilience, registry validation, metering, live events ----

  it('narrates a brain outage instead of failing the send (AC-BRAIN-03)', async () => {
    const failing: AgentBrainPort = {
      complete: (req) => ctx.brain.complete(req),
      stream: async function* () {
        throw new Error('synthetic brain outage');
        yield { delta: '' }; // eslint-disable-line no-unreachable
      },
      embed: (t) => ctx.brain.embed(t),
    };
    const session = await makeSession();
    const res = await makeSend(failing).execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    expect(res.answer.content.toLowerCase()).toContain('unavailable');
    const rows = await ctx.chatMessages.listForSession(session.id);
    expect(rows.map((m) => m.role)).toEqual(['USER', 'AGENT']);
  });

  it('schema-invalid tool args are narrated + audited, the use case never runs (AC-TOOL-02)', async () => {
    await makeFeature();
    const rogue: AgentBrainPort = {
      complete: (req) => ctx.brain.complete(req),
      stream: async function* () {
        yield { delta: JSON.stringify({ tool: 'enqueue_run' }) };
      },
      embed: (t) => ctx.brain.embed(t),
    };
    const session = await makeSession();
    const res = await makeSend(rogue).execute({ userId, sessionId: session.id, content: 'run something' });
    expect(res.answer.content).toContain('INVALID_ARGS');
    expect(await ctx.runs.listForProject(projectId)).toHaveLength(0);
    const audit = ctx.audit.rows.find((r) => r.action === 'chat.tool.invoked')!;
    expect(audit.metadata).toMatchObject({ tool: 'enqueue_run', outcome: 'INVALID_ARGS' });
  });

  it('meters the router and the answer per org (AC-METER-01)', async () => {
    const session = await makeSession();
    await makeSend().execute({ userId, sessionId: session.id, content: 'our checkout p95 latency explodes under load' });
    const rows = ctx.brainUsage.rows.filter((r) => r.orgId === orgId);
    expect(rows.some((r) => r.surface === 'ROUTER' && r.tier === 'HAIKU')).toBe(true);
    expect(rows.some((r) => r.surface === 'CHAT' && r.tier === 'SONNET' && r.outputTokens > 0)).toBe(true);
  });

  it('a pinned send writes no ROUTER usage row (AC-METER-01)', async () => {
    const session = await makeSession(await agentId('sec'));
    await makeSend().execute({ userId, sessionId: session.id, content: 'how should we test this' });
    expect(ctx.brainUsage.rows.some((r) => r.surface === 'ROUTER')).toBe(false);
    expect(ctx.brainUsage.rows.some((r) => r.surface === 'CHAT')).toBe(true);
  });

  it('publishes live chat events on the bus (AC-SSE-01)', async () => {
    const session = await makeSession();
    const seen: { type: string }[] = [];
    const unsubscribe = ctx.events.subscribe(`chat:${session.id}`, (e) => seen.push(e as { type: string }));
    await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    unsubscribe();
    const types = seen.map((e) => e.type);
    expect(types.filter((t) => t === 'MESSAGE').length).toBeGreaterThanOrEqual(2); // USER + AGENT
    expect(types).toContain('DELTA');
    expect(types[types.length - 1]).toBe('DONE');
  });

  // ---- Slice 14: AI token billing (AC-TOKB-02/05/06) ----

  const exhaustTokens = async () => {
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.save({ ...sub, brainTokensUsed: sub.brainTokensQuota });
  };

  it('charges the send atomically: brainTokensUsed equals the billable sum of its usage rows (AC-TOKB-02)', async () => {
    const session = await makeSession();
    await makeSend().execute({ userId, sessionId: session.id, content: 'our checkout p95 latency explodes under load' });
    const rows = ctx.brainUsage.rows.filter((r) => r.orgId === orgId);
    expect(rows.length).toBeGreaterThanOrEqual(2); // ROUTER + CHAT
    const billable = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
    expect(billable).toBeGreaterThan(0);
    expect((await ctx.subscriptions.findByOrg(orgId))!.brainTokensUsed).toBe(billable);
  });

  it('an exhausted allowance narrates the block: no 500, no brain call, nothing charged (AC-TOKB-05)', async () => {
    const session = await makeSession();
    await exhaustTokens();
    const before = (await ctx.subscriptions.findByOrg(orgId))!.brainTokensUsed;

    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    expect(res.answer.content).toBe(CHAT_TOKEN_QUOTA_NARRATION);

    const rows = await ctx.chatMessages.listForSession(session.id);
    expect(rows.map((m) => m.role)).toEqual(['USER', 'AGENT']); // the USER message persisted first
    expect(ctx.brainUsage.rows.filter((r) => r.orgId === orgId)).toHaveLength(0);
    expect((await ctx.subscriptions.findByOrg(orgId))!.brainTokensUsed).toBe(before);
  });

  it('a pinned session narrates the block via the pinned agent, without a router call (AC-TOKB-05)', async () => {
    const sec = await agentId('sec');
    const session = await makeSession(sec);
    await exhaustTokens();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    expect(res.answer.content).toBe(CHAT_TOKEN_QUOTA_NARRATION);
    expect(res.answer.agentId).toBe(sec);
    expect(ctx.brainUsage.rows).toHaveLength(0);
  });

  it('SCALE is unlimited: a maxed-out counter never blocks, and usage keeps charging (AC-TOKB-06)', async () => {
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.save({ ...sub, plan: 'SCALE', brainTokensUsed: sub.brainTokensQuota + 1 });
    const before = sub.brainTokensQuota + 1;

    const session = await makeSession();
    const res = await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    expect(res.answer.content).not.toBe(CHAT_TOKEN_QUOTA_NARRATION);
    expect(ctx.brainUsage.rows.some((r) => r.surface === 'CHAT')).toBe(true);
    expect((await ctx.subscriptions.findByOrg(orgId))!.brainTokensUsed).toBeGreaterThan(before);
  });

  // ---- Events (C3 replay) ----

  it('replays the session messages as ordered events; tenant-isolated (AC-CRUN-03/AC-CHAT-03)', async () => {
    const session = await makeSession();
    await makeSend().execute({ userId, sessionId: session.id, content: 'hello pantheon' });
    const events = await new GetChatEvents(ctx).execute({ userId, sessionId: session.id });
    expect(events.map((e) => e.role)).toEqual(['USER', 'AGENT']);

    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve2@nippur.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetChatEvents(ctx).execute({ userId: outsider, sessionId: session.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
