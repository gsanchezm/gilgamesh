import { describe, expect, it } from 'vitest';
import { DeterministicBrain } from '../brain/stub-brain';
import type { AgentBrainPort, KindAwareEmbeddingBrain } from '../ports/brain';
import { createInMemoryContext, InMemoryKnowledgeChunkRepository } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { IngestKnowledge, KnowledgeRetriever, SearchKnowledge, type RawChunk } from './knowledge';
import { UploadKnowledgeDocument } from './knowledge-documents';
import { RegisterUser } from './register-user';

/**
 * S19 (AC-VBYOK-05): org-attributable embeds resolve through the OPTIONAL `forOrg(orgId)` extension —
 * the seam where the SelectingBrain adapter resolves an org's voyage BYOK key at call time. Org-less
 * paths (global corpus ingest, the org-less retrieve) keep the platform selection by construction.
 */

/** A working lexical brain that records which instance served each embed call. */
function recordingBrain(label: string, calls: string[]): AgentBrainPort & KindAwareEmbeddingBrain {
  const inner = new DeterministicBrain();
  return {
    complete: (req) => inner.complete(req),
    stream: (req) => inner.stream(req),
    embed: (texts) => {
      calls.push(`${label}:embed`);
      return inner.embed(texts);
    },
    embedAs: (texts, kind) => {
      calls.push(`${label}:embedAs:${kind}`);
      return inner.embedAs(texts, kind);
    },
  };
}

function makeOrgRoutingBrain() {
  const calls: string[] = [];
  const forOrgCalls: string[] = [];
  const base = Object.assign(recordingBrain('base', calls), {
    forOrg: (orgId: string) => {
      forOrgCalls.push(orgId);
      return recordingBrain('org', calls);
    },
  });
  return { base, calls, forOrgCalls };
}

const CHUNK: RawChunk = {
  id: 'c1',
  source: 'ISTQB_CTFL_Syllabus',
  headingPath: ['Testing'],
  section: '1.1',
  text: 'Boundary value analysis targets the edges of equivalence partitions where defects cluster.',
};

describe('org-scoped embedding resolution (S19 AC-VBYOK-05 — the forOrg seam)', () => {
  it('SearchKnowledge with an orgId embeds through brain.forOrg(orgId)', async () => {
    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    const knowledge = new InMemoryKnowledgeChunkRepository();
    await new SearchKnowledge({ knowledge, brain: base }).execute({ query: 'boundary values', orgId: 'org-1' });
    expect(forOrgCalls).toEqual(['org-1']);
    expect(calls).toEqual(['org:embedAs:query']);
  });

  it('SearchKnowledge without an orgId keeps the platform brain (no forOrg lookup)', async () => {
    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    const knowledge = new InMemoryKnowledgeChunkRepository();
    await new SearchKnowledge({ knowledge, brain: base }).execute({ query: 'boundary values' });
    expect(forOrgCalls).toEqual([]);
    expect(calls).toEqual(['base:embedAs:query']);
  });

  it('KnowledgeRetriever.retrieveScoped embeds through brain.forOrg(filter.orgId)', async () => {
    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    const knowledge = new InMemoryKnowledgeChunkRepository();
    await new KnowledgeRetriever({ knowledge, brain: base }).retrieveScoped('boundary values', 4, { orgId: 'org-9' });
    expect(forOrgCalls).toEqual(['org-9']);
    expect(calls).toEqual(['org:embedAs:query']);
  });

  it('the org-less KnowledgeRetriever.retrieve keeps the platform brain', async () => {
    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    const knowledge = new InMemoryKnowledgeChunkRepository();
    await new KnowledgeRetriever({ knowledge, brain: base }).retrieve('boundary values', 4);
    expect(forOrgCalls).toEqual([]);
    expect(calls).toEqual(['base:embedAs:query']);
  });

  it('IngestKnowledge embeds through forOrg only when the call is org-attributed', async () => {
    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    const knowledge = new InMemoryKnowledgeChunkRepository();
    const ingest = new IngestKnowledge({ knowledge, brain: base });
    await ingest.execute([CHUNK], { orgId: 'org-2' });
    expect(forOrgCalls).toEqual(['org-2']);
    await ingest.execute([{ ...CHUNK, id: 'c2' }]); // the platform-global corpus path
    expect(forOrgCalls).toEqual(['org-2']); // unchanged — no org to resolve
    expect(calls).toEqual(['org:embedAs:document', 'base:embedAs:document']);
  });

  it('UploadKnowledgeDocument embeds through brain.forOrg(input.orgId)', async () => {
    const ctx = createInMemoryContext();
    const { userId } = await new RegisterUser(ctx).execute({
      firstName: 'I',
      lastName: 'U',
      email: 'owner@uruk.io',
      password: 'C0rrect-Horse!',
    });
    const { orgId } = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });

    const { base, calls, forOrgCalls } = makeOrgRoutingBrain();
    await new UploadKnowledgeDocument({ ...ctx, brain: base }).execute({
      orgId,
      userId,
      name: 'qa-notes.md',
      type: 'md',
      content: 'Boundary value analysis targets the edges of equivalence partitions where defects cluster.',
    });
    expect(forOrgCalls).toEqual([orgId]);
    expect(calls).toEqual(['org:embedAs:document']);
  });

  it('a brain without the forOrg extension keeps the direct path (feature detection)', async () => {
    const calls: string[] = [];
    const plain = recordingBrain('base', calls);
    const knowledge = new InMemoryKnowledgeChunkRepository();
    await new SearchKnowledge({ knowledge, brain: plain }).execute({ query: 'boundary values', orgId: 'org-1' });
    expect(calls).toEqual(['base:embedAs:query']);
  });
});
