import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentBrainPort, EmbeddingKind, KindAwareEmbeddingBrain } from '../ports/brain';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { IngestKnowledge, KnowledgeRetriever, type RawChunk, SearchKnowledge } from './knowledge';

const CHUNKS: RawChunk[] = [
  {
    id: 'c1',
    source: 'bddbooks-discovery.pdf',
    headingPath: ['Discovery', 'Example Mapping'],
    section: 'Example Mapping',
    text: 'Example mapping is a collaborative discovery technique using coloured cards for rules and examples. Page 12 of 45',
  },
  {
    id: 'c2',
    source: 'ISTQB-CT-PT.pdf',
    headingPath: ['Performance'],
    section: 'Load testing',
    text: 'Performance testing measures throughput and latency under load. © International Software Testing Qualifications Board',
  },
  { id: 'c3', source: 'tiny', headingPath: [], section: '', text: 'Page 1 of 9' },
];

describe('Knowledge / RAG', () => {
  let ctx: InMemoryContext;
  beforeEach(() => {
    ctx = createInMemoryContext();
  });

  it('ingests scrubbed chunks and drops boilerplate-only ones (AC-KB-01/02)', async () => {
    const r = await new IngestKnowledge(ctx).execute(CHUNKS);
    expect(r).toEqual({ ingested: 2, skipped: 1 });
    expect(await ctx.knowledge.count()).toBe(2);

    const res = await new SearchKnowledge(ctx).execute({ query: 'example mapping cards' });
    expect(res.results[0]!.content).not.toMatch(/Page 12 of 45/);
  });

  it('searches by lexical relevance with citations, deterministically (AC-KB-04/05/09)', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const res = await new SearchKnowledge(ctx).execute({ query: 'example mapping discovery cards', k: 2 });
    expect(res.results[0]!.citation).toMatchObject({ source: 'bddbooks-discovery.pdf', section: 'Example Mapping' });
    expect(res.results[0]!.score).toBeGreaterThan(0);
    expect(res.total).toBe(2);

    const again = await new SearchKnowledge(ctx).execute({ query: 'example mapping discovery cards', k: 2 });
    expect(again.results.map((x) => x.citation.source)).toEqual(res.results.map((x) => x.citation.source));
  });

  it('rejects an empty query (VALIDATION)', async () => {
    await expect(new SearchKnowledge(ctx).execute({ query: '   ' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('returns empty for a tokenless query (zero embedding), not a degenerate ranking (AC-KB-05)', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const res = await new SearchKnowledge(ctx).execute({ query: '!!! ??? —' });
    expect(res.results).toEqual([]);
    expect(res.total).toBe(2);
  });

  it('breaks score ties deterministically by chunk id (AC-KB-05 parity)', async () => {
    // identical text -> identical embedding -> exact score tie -> deterministic id-asc order.
    await new IngestKnowledge(ctx).execute([
      { id: 'chunk-b', source: 'B', headingPath: [], section: '', text: 'identical reference text about testing techniques' },
      { id: 'chunk-a', source: 'A', headingPath: [], section: '', text: 'identical reference text about testing techniques' },
    ]);
    const res = await new SearchKnowledge(ctx).execute({ query: 'testing techniques reference', k: 2 });
    expect(res.results.map((r) => r.citation.source)).toEqual(['A', 'B']);
  });
});

// ---- S16: EMBED metering + input-kind threading (AC-EMB-04/05/06) --------------------------------

/** Behavior-preserving wrapper that records which embedAs kind each call used. */
function recordingBrain(ctx: InMemoryContext, kinds: EmbeddingKind[]): AgentBrainPort & KindAwareEmbeddingBrain {
  return {
    complete: ctx.brain.complete.bind(ctx.brain),
    stream: ctx.brain.stream.bind(ctx.brain),
    embed: ctx.brain.embed.bind(ctx.brain),
    embedAs: (texts, kind) => {
      kinds.push(kind);
      return ctx.brain.embedAs(texts, kind);
    },
  };
}

/** A bare frozen-port brain WITHOUT the embedAs extension (feature-detection fallback path). */
function bareBrain(ctx: InMemoryContext): AgentBrainPort {
  return {
    complete: ctx.brain.complete.bind(ctx.brain),
    stream: ctx.brain.stream.bind(ctx.brain),
    embed: ctx.brain.embed.bind(ctx.brain),
  };
}

describe('Knowledge EMBED metering (S16)', () => {
  let ctx: InMemoryContext;
  let kinds: EmbeddingKind[];
  // S14: the meter is now the shared BrainBilling seam (rows + token charge, atomically).
  const meterOf = (c: InMemoryContext) => c.billing;

  beforeEach(() => {
    ctx = createInMemoryContext();
    kinds = [];
  });

  it('SearchKnowledge meters ONE EMBED row for the caller org, embedding with the query kind', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: recordingBrain(ctx, kinds), meter: meterOf(ctx) });
    const res = await search.execute({ query: 'example mapping cards', orgId: 'org-1' });
    expect(res.results.length).toBeGreaterThan(0);

    const rows = await ctx.brainUsage.listForOrg('org-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: 'EMBED', tier: 'HAIKU', outputTokens: 0 });
    expect(rows[0]!.inputTokens).toBeGreaterThan(0); // the stub's whitespace-token estimate
    expect(kinds).toEqual(['query']);
  });

  it('SearchKnowledge without an orgId stays unmetered (nothing to attribute)', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    await search.execute({ query: 'example mapping cards' });
    expect(ctx.brainUsage.rows).toHaveLength(0);
  });

  it('a metering failure NEVER breaks the search (resilience)', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    ctx.brainUsage.append = async () => {
      throw new Error('usage store down');
    };
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    const res = await search.execute({ query: 'example mapping cards', orgId: 'org-1' });
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('IngestKnowledge embeds with the document kind; unattributed (global) ingest writes NO usage', async () => {
    const ingest = new IngestKnowledge({ knowledge: ctx.knowledge, brain: recordingBrain(ctx, kinds), meter: meterOf(ctx) });
    await ingest.execute(CHUNKS);
    expect(kinds).toEqual(['document']);
    expect(ctx.brainUsage.rows).toHaveLength(0); // BrainUsage.orgId is frozen non-null (AC-EMB-06)
  });

  it('IngestKnowledge meters when the call is attributed to an org', async () => {
    const ingest = new IngestKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    await ingest.execute(CHUNKS, { orgId: 'org-7' });
    const rows = await ctx.brainUsage.listForOrg('org-7');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: 'EMBED', tier: 'HAIKU', outputTokens: 0 });
  });

  it('KnowledgeRetriever meters scoped grounding for the filter org; unscoped retrieve stays unmetered', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const retriever = new KnowledgeRetriever({ knowledge: ctx.knowledge, brain: recordingBrain(ctx, kinds), meter: meterOf(ctx) });

    await retriever.retrieve('example mapping', 2);
    expect(ctx.brainUsage.rows).toHaveLength(0); // no org in scope

    await retriever.retrieveScoped('example mapping', 2, { orgId: 'org-3' });
    const rows = await ctx.brainUsage.listForOrg('org-3');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: 'EMBED', tier: 'HAIKU' });
    expect(kinds).toEqual(['query', 'query']); // grounding queries always embed as query
  });

  it('falls back to the frozen embed() when the brain lacks embedAs (row carries 0 tokens)', async () => {
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: bareBrain(ctx), meter: meterOf(ctx) });
    const res = await search.execute({ query: 'example mapping cards', orgId: 'org-1' });
    expect(res.results.length).toBeGreaterThan(0); // behavior preserved through the frozen port
    const rows = await ctx.brainUsage.listForOrg('org-1');
    expect(rows).toHaveLength(1); // the call still happened -> one row, tokens unknown
    expect(rows[0]!.inputTokens).toBe(0);
  });

  // ---- Slice 14: token quota on EMBED surfaces (AC-TOKB-03/04) ----

  const seedSub = (orgId: string, brainTokensUsed: number) =>
    ctx.subscriptions.create({
      id: `sub-${orgId}`,
      orgId,
      plan: 'FREE',
      billingCycle: 'MONTHLY',
      seats: 1,
      status: 'ACTIVE',
      runMinutesQuota: 500,
      runMinutesUsed: 0,
      brainTokensQuota: 100_000,
      brainTokensUsed,
      providerCustomerId: null,
      providerSubscriptionId: null,
      currentPeriodEnd: null,
    });

  it('the embed charge lands on the org counter atomically with the usage row (AC-TOKB-03)', async () => {
    await seedSub('org-1', 0);
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    await search.execute({ query: 'example mapping cards', orgId: 'org-1' });
    const [row] = await ctx.brainUsage.listForOrg('org-1');
    expect(row!.inputTokens).toBeGreaterThan(0);
    expect((await ctx.subscriptions.findByOrg('org-1'))!.brainTokensUsed).toBe(row!.inputTokens);
  });

  it('an exhausted allowance blocks the org-attributed search BEFORE the embed (AC-TOKB-04)', async () => {
    await seedSub('org-1', 100_000);
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    await expect(search.execute({ query: 'example mapping cards', orgId: 'org-1' })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(await ctx.brainUsage.listForOrg('org-1')).toHaveLength(0);
  });

  it('an exhausted allowance blocks the org-attributed ingest too (AC-TOKB-04)', async () => {
    await seedSub('org-7', 100_000);
    const ingest = new IngestKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    await expect(ingest.execute(CHUNKS, { orgId: 'org-7' })).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('an unattributed (global) search is never quota-blocked', async () => {
    await seedSub('org-1', 100_000);
    await new IngestKnowledge(ctx).execute(CHUNKS);
    const search = new SearchKnowledge({ knowledge: ctx.knowledge, brain: ctx.brain, meter: meterOf(ctx) });
    const res = await search.execute({ query: 'example mapping cards' });
    expect(res.results.length).toBeGreaterThan(0);
  });
});
