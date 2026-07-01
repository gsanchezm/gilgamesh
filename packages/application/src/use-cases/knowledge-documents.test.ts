import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { ListKnowledgeDocuments, UploadKnowledgeDocument } from './knowledge-documents';

const ORG = 'org-a';
const USER = 'user-1';

function seedMember(ctx: InMemoryContext, orgId = ORG, userId = USER) {
  return ctx.memberships.create({
    id: `m-${orgId}-${userId}`,
    orgId,
    userId,
    role: 'MEMBER',
    createdAt: ctx.clock.now(),
  });
}

function uploader(ctx: InMemoryContext) {
  return new UploadKnowledgeDocument({
    documents: ctx.knowledgeDocuments,
    knowledge: ctx.knowledge,
    brain: ctx.brain,
    memberships: ctx.memberships,
    ids: ctx.ids,
    clock: ctx.clock,
  });
}

function lister(ctx: InMemoryContext) {
  return new ListKnowledgeDocuments({ documents: ctx.knowledgeDocuments, memberships: ctx.memberships });
}

const MD = '# Test Design\n\nBoundary value analysis picks the edges of each equivalence class.';

describe('UploadKnowledgeDocument', () => {
  let ctx: InMemoryContext;
  beforeEach(() => {
    ctx = createInMemoryContext();
  });

  it('ingests the text into per-org chunks and records the document', async () => {
    await seedMember(ctx);
    const doc = await uploader(ctx).execute({
      orgId: ORG,
      userId: USER,
      name: 'design.md',
      type: 'md',
      content: MD,
    });

    expect(doc.name).toBe('design.md');
    expect(doc.chunkCount).toBeGreaterThan(0);

    const listed = await lister(ctx).execute({ orgId: ORG, userId: USER });
    expect(listed.map((d) => d.name)).toContain('design.md');
    expect(listed[0]!.chunkCount).toBe(doc.chunkCount);
  });

  it('does NOT leak per-org chunks into the global shared search', async () => {
    await seedMember(ctx);
    // A shared-corpus chunk (no orgId) — the only thing global search/count should see.
    await ctx.knowledge.upsertMany([
      {
        id: 'global-1',
        source: 'ISTQB',
        headingPath: [],
        section: 'Foundations',
        content: 'Equivalence partitioning divides inputs into classes.',
        embedding: (await ctx.brain.embed(['Equivalence partitioning divides inputs into classes.']))[0]!,
        tokenEstimate: 6,
      },
    ]);

    await uploader(ctx).execute({ orgId: ORG, userId: USER, name: 'private.md', type: 'md', content: MD });

    // Global corpus count stays 1 — the per-org chunks are excluded.
    expect(await ctx.knowledge.count()).toBe(1);
    const [q] = await ctx.brain.embed(['boundary value analysis']);
    const hits = await ctx.knowledge.search(q!, 10);
    expect(hits.every((h) => h.chunk.orgId == null)).toBe(true);
  });

  it('rejects a non-member with NOT_FOUND (existence not leaked)', async () => {
    await expect(
      uploader(ctx).execute({ orgId: ORG, userId: 'intruder', name: 'x.md', type: 'md', content: MD }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects content with no indexable text', async () => {
    await seedMember(ctx);
    await expect(
      uploader(ctx).execute({ orgId: ORG, userId: USER, name: 'empty.md', type: 'md', content: '   \n\n  ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('ListKnowledgeDocuments', () => {
  let ctx: InMemoryContext;
  beforeEach(() => {
    ctx = createInMemoryContext();
  });

  it('is isolated per org', async () => {
    await seedMember(ctx, ORG, USER);
    await seedMember(ctx, 'org-b', USER);
    await uploader(ctx).execute({ orgId: ORG, userId: USER, name: 'a.md', type: 'md', content: MD });

    const bDocs = await lister(ctx).execute({ orgId: 'org-b', userId: USER });
    expect(bDocs).toEqual([]);
  });

  it('rejects a non-member with NOT_FOUND', async () => {
    await expect(lister(ctx).execute({ orgId: ORG, userId: 'intruder' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
