import { parseFeature, type KnowledgeScope } from '@gilgamesh/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GenerateDrafts } from './testlab-generate';
import { IngestKnowledge } from './knowledge';
import { RegisterUser } from './register-user';

describe('Test Lab — AI generate (stub brain)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const onboarded = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  it('returns parseable BDD feature drafts and persists nothing (AC-GEN-01/02)', async () => {
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'checkout flow', count: 2 });

    expect(drafts.testCases).toEqual([]);
    expect(drafts.features).toHaveLength(1);
    const parsed = parseFeature(drafts.features[0]!.content);
    expect(parsed.scenarios).toHaveLength(2);

    // Nothing was written to the lab.
    expect(await ctx.features.listForProject(projectId)).toEqual([]);
    expect(await ctx.testCases.listForProject(projectId)).toEqual([]);

    // Audited without the raw prompt text.
    const audited = ctx.audit.rows.find((r) => r.action === 'testlab.generated');
    expect(audited?.metadata).toMatchObject({ features: 1, promptLength: 'checkout flow'.length });
    expect(JSON.stringify(audited?.metadata)).not.toContain('checkout flow');
  });

  it('is deterministic and offline (same input -> same output) (AC-GEN-02)', async () => {
    const a = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'same', count: 3 });
    const b = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'same', count: 3 });
    expect(a).toEqual(b);
  });

  it('generates traditional test-case drafts with valid priority', async () => {
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'login', format: 'TRADITIONAL', count: 3 });
    expect(drafts.features).toEqual([]);
    expect(drafts.testCases).toHaveLength(3);
    expect(drafts.testCases.every((t) => ['HIGH', 'MEDIUM', 'LOW'].includes(t.priority))).toBe(true);
  });

  it('caps drafts to the requested count even if the brain returns more', async () => {
    const floodBrain = {
      complete: async () => ({
        text: JSON.stringify({
          features: Array.from({ length: 20 }, (_, i) => ({
            name: `F${i}`,
            path: 'x.feature',
            content: 'Feature: X\n  Scenario: S\n    Then ok',
          })),
          testCases: [],
        }),
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
      stream: async function* () {},
      embed: async () => [],
    };
    const drafts = await new GenerateDrafts({ ...ctx, brain: floodBrain }).execute({
      userId,
      projectId,
      prompt: 'x',
      count: 3,
    });
    expect(drafts.features).toHaveLength(3);
  });

  it('grounds generation in the knowledge base and returns citations (AC-KB-07)', async () => {
    await new IngestKnowledge(ctx).execute([
      {
        id: 'k1',
        source: 'bddbooks-formulation.pdf',
        headingPath: ['Formulation', 'BRIEF'],
        section: 'BRIEF',
        text: 'Good scenarios follow BRIEF: business language, real data, intention-revealing, essential, focused, brief.',
      },
    ]);
    const drafts = await new GenerateDrafts(ctx).execute({
      userId,
      projectId,
      prompt: 'BRIEF scenarios business language intention revealing',
      count: 1,
    });
    expect(drafts.citations.length).toBeGreaterThan(0);
    expect(drafts.citations[0]!.source).toBe('bddbooks-formulation.pdf');
    const audited = ctx.audit.rows.find((r) => r.action === 'testlab.generated');
    expect(audited?.metadata).toMatchObject({ grounded: drafts.citations.length });
  });

  it('returns empty citations when the knowledge base is empty', async () => {
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'x', count: 1 });
    expect(drafts.citations).toEqual([]);
  });

  describe('per-org grounding (retrieveScoped without a slot)', () => {
    async function seedChunk(name: string, opts: { orgId: string | null; scope: KnowledgeScope | null }) {
      const content = `${name}: BRIEF scenarios use business language and intention-revealing names.`;
      const [embedding] = await ctx.brain.embed([content]);
      await ctx.knowledge.upsertMany([
        {
          id: `kb-${name.toLowerCase()}`,
          orgId: opts.orgId,
          documentId: null,
          source: name,
          headingPath: [name],
          section: name,
          content,
          embedding: embedding!,
          tokenEstimate: 10,
          scope: opts.scope,
        },
      ]);
    }

    const generate = () =>
      new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'BRIEF scenarios business language', count: 1 });

    it("grounds drafts in my org's uploaded chunks (scope NULL or 'shared')", async () => {
      await seedChunk('ORG-STYLE-GUIDE', { orgId, scope: null });
      await seedChunk('ORG-HOUSE-RULES', { orgId, scope: 'shared' });
      const sources = (await generate()).citations.map((c) => c.source);
      expect(sources).toContain('ORG-STYLE-GUIDE');
      expect(sources).toContain('ORG-HOUSE-RULES');
    });

    it('never grounds drafts in an agent-scoped chunk (stays private to that agent chat)', async () => {
      await seedChunk('SEC-PLAYBOOK', { orgId, scope: 'sec' });
      const sources = (await generate()).citations.map((c) => c.source);
      expect(sources).not.toContain('SEC-PLAYBOOK');
    });

    it("never grounds drafts in another org's chunks (tenant isolation)", async () => {
      const rivalUser = (
        await new RegisterUser(ctx).execute({ firstName: 'R', lastName: 'V', email: 'rival@lagash.io', password: 'C0rrect-Horse!' })
      ).userId;
      const rival = await new CompleteOnboarding(ctx).execute({ userId: rivalUser, projectName: 'Rival', format: 'BDD' });
      await seedChunk('RIVAL-SECRETS', { orgId: rival.orgId, scope: null });
      const sources = (await generate()).citations.map((c) => c.source);
      expect(sources).not.toContain('RIVAL-SECRETS');
    });

    it('still grounds in the global shared corpus alongside org chunks', async () => {
      await seedChunk('GLOBAL-ISTQB', { orgId: null, scope: null });
      await seedChunk('ORG-STYLE-GUIDE', { orgId, scope: null });
      const sources = (await generate()).citations.map((c) => c.source);
      expect(sources).toContain('GLOBAL-ISTQB');
      expect(sources).toContain('ORG-STYLE-GUIDE');
    });
  });

  // ---- Slice 14: AI token billing (AC-TOKB-03/04/06) ----

  it('charges the GENERATE call: brainTokensUsed equals the billable sum of the usage rows (AC-TOKB-03)', async () => {
    await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'checkout flow', count: 1 });
    const rows = ctx.brainUsage.rows.filter((r) => r.orgId === orgId);
    expect(rows.some((r) => r.surface === 'GENERATE' && r.tier === 'SONNET')).toBe(true);
    const billable = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
    expect((await ctx.subscriptions.findByOrg(orgId))!.brainTokensUsed).toBe(billable);
  });

  it('an exhausted allowance blocks generate with QUOTA_EXCEEDED and no brain call (AC-TOKB-04)', async () => {
    // Through the charge path — save() no longer persists the counters (review S14 #1).
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.chargeBrainTokens(orgId, sub.brainTokensQuota - sub.brainTokensUsed);
    await expect(
      new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'checkout flow' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(ctx.brainUsage.rows).toHaveLength(0);
  });

  it('SCALE never blocks generate, even with a maxed-out counter (AC-TOKB-06)', async () => {
    const sub = (await ctx.subscriptions.findByOrg(orgId))!;
    await ctx.subscriptions.save({ ...sub, plan: 'SCALE' });
    await ctx.subscriptions.chargeBrainTokens(orgId, sub.brainTokensQuota + 1);
    const drafts = await new GenerateDrafts(ctx).execute({ userId, projectId, prompt: 'checkout flow', count: 1 });
    expect(drafts.features.length).toBeGreaterThan(0);
  });

  it('rejects an empty prompt (VALIDATION)', async () => {
    await expect(new GenerateDrafts(ctx).execute({ userId, projectId, prompt: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('enforces authz: outsider NOT_FOUND, viewer FORBIDDEN (AC-GEN-03)', async () => {
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(
      new GenerateDrafts(ctx).execute({ userId: outsider, projectId, prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });
    await expect(
      new GenerateDrafts(ctx).execute({ userId: viewer, projectId, prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
