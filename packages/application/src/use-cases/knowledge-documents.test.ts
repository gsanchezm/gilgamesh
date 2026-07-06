import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setInflateSync } from '@gilgamesh/domain';
import { inflateSync } from 'node:zlib';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { ListKnowledgeDocuments, UploadKnowledgeDocument } from './knowledge-documents';

const ORG = 'org-a';
const USER = 'user-1';

beforeAll(() => {
  setInflateSync((data) => inflateSync(data));
});

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
    uow: ctx.uow,
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

  it('ingests a PDF document successfully', async () => {
    await seedMember(ctx);
    const pdfStr =
      '%PDF-1.4\n' +
      '1 0 obj\n' +
      '<< /Length 30 >>\n' +
      'stream\n' +
      'BT\n' +
      '(PDF Text Content) Tj\n' +
      'ET\n' +
      'endstream\n' +
      'endobj\n' +
      '%%EOF';
    const base64 = Buffer.from(pdfStr, 'latin1').toString('base64');

    const doc = await uploader(ctx).execute({
      orgId: ORG,
      userId: USER,
      name: 'design.pdf',
      type: 'pdf',
      content: base64,
    });

    expect(doc.name).toBe('design.pdf');
    expect(doc.chunkCount).toBeGreaterThan(0);
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

  it('does not write chunks when the document row cannot be created (atomic — no orphans)', async () => {
    await seedMember(ctx);
    // The document write is attempted first; make it fail and assert no chunks were persisted.
    let chunksWritten = false;
    const upsertMany = ctx.knowledge.upsertMany.bind(ctx.knowledge);
    ctx.knowledge.upsertMany = async (recs) => {
      chunksWritten = true;
      return upsertMany(recs);
    };
    ctx.knowledgeDocuments.create = async () => {
      throw new Error('db down: document write failed');
    };

    await expect(
      uploader(ctx).execute({ orgId: ORG, userId: USER, name: 'design.md', type: 'md', content: MD }),
    ).rejects.toThrow(/document write failed/);

    expect(chunksWritten).toBe(false);
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

describe('UploadKnowledgeDocument — EMBED metering (S16, AC-EMB-05)', () => {
  let ctx: InMemoryContext;
  beforeEach(() => {
    ctx = createInMemoryContext();
  });

  it('meters ONE EMBED row for the org, embedding chunks with the document kind', async () => {
    await seedMember(ctx);
    const kinds: string[] = [];
    const brain = {
      complete: ctx.brain.complete.bind(ctx.brain),
      stream: ctx.brain.stream.bind(ctx.brain),
      embed: ctx.brain.embed.bind(ctx.brain),
      embedAs: (texts: string[], kind: 'query' | 'document') => {
        kinds.push(kind);
        return ctx.brain.embedAs(texts, kind);
      },
    };
    const upload = new UploadKnowledgeDocument({
      uow: ctx.uow,
      brain,
      memberships: ctx.memberships,
      ids: ctx.ids,
      clock: ctx.clock,
      meter: { brainUsage: ctx.brainUsage, ids: ctx.ids, clock: ctx.clock },
    });
    await upload.execute({ orgId: ORG, userId: USER, name: 'design.md', type: 'md', content: MD });

    expect(kinds).toEqual(['document']);
    const rows = await ctx.brainUsage.listForOrg(ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: 'EMBED', tier: 'HAIKU', outputTokens: 0 });
    expect(rows[0]!.inputTokens).toBeGreaterThan(0);
  });

  it('a metering failure never fails the upload (resilience)', async () => {
    await seedMember(ctx);
    ctx.brainUsage.append = async () => {
      throw new Error('usage store down');
    };
    const upload = new UploadKnowledgeDocument({
      uow: ctx.uow,
      brain: ctx.brain,
      memberships: ctx.memberships,
      ids: ctx.ids,
      clock: ctx.clock,
      meter: { brainUsage: ctx.brainUsage, ids: ctx.ids, clock: ctx.clock },
    });
    const doc = await upload.execute({ orgId: ORG, userId: USER, name: 'design.md', type: 'md', content: MD });
    expect(doc.chunkCount).toBeGreaterThan(0);
  });
});
