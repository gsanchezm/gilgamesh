import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { IngestKnowledge, type RawChunk, SearchKnowledge } from './knowledge';

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
});
