import { type AgentBrainPort, IngestKnowledge, type KnowledgeChunkRepository } from '@gilgamesh/application';
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TOKENS } from '../../src/persistence/tokens';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

// Known, deterministic reference chunks so search ranking is stable across runs.
const REFERENCE_CHUNKS = [
  {
    id: 'kb-discovery',
    source: 'bddbooks-discovery',
    headingPath: ['Discovery', 'Example Mapping'],
    section: 'Example Mapping',
    text: 'Example mapping is a collaborative discovery technique using coloured cards for rules, concrete examples and open questions.',
  },
  {
    id: 'kb-ctfl-bva',
    source: 'ISTQB_CTFL_Syllabus_v4.0.1',
    headingPath: ['Test Techniques', 'Boundary Value Analysis'],
    section: 'Boundary Value Analysis',
    text: 'Boundary value analysis is a black-box technique testing the minimum and maximum edges of equivalence partitions where defects cluster.',
  },
  {
    id: 'kb-formulation',
    source: 'bddbooks-formulation',
    headingPath: ['Formulation', 'BRIEF'],
    section: 'BRIEF',
    text: 'Good Gherkin scenarios follow the BRIEF principles: business language, real data, intention revealing, essential, focused.',
  },
];

Given('the knowledge base has QA reference material', async function (this: GilgameshWorld) {
  const knowledge = this.app.get(TOKENS.Knowledge) as KnowledgeChunkRepository;
  const brain = this.app.get(TOKENS.Brain) as AgentBrainPort;
  await new IngestKnowledge({ knowledge, brain }).execute(REFERENCE_CHUNKS);
});

When('I search the knowledge base for {string}', async function (this: GilgameshWorld, query: string) {
  this.response = await this.applyAuth(
    server(this).get(`${this.basePath}/knowledge/search`).query({ q: query, k: 5 }),
  );
});

Then('the search returns at least {int} result(s)', function (this: GilgameshWorld, n: number) {
  const results = (this.response?.body?.results ?? []) as unknown[];
  assert.ok(results.length >= n, `expected >= ${n} results, got ${results.length}`);
});

Then('the top result cites {string}', function (this: GilgameshWorld, source: string) {
  const results = (this.response?.body?.results ?? []) as { citation: { source: string } }[];
  assert.ok(results.length > 0, 'no results');
  assert.ok(
    results[0]!.citation.source.includes(source),
    `top result cites "${results[0]!.citation.source}", expected to include "${source}"`,
  );
});

Then('the generated drafts carry at least {int} citation(s)', function (this: GilgameshWorld, n: number) {
  const citations = (this.response?.body?.citations ?? []) as unknown[];
  assert.ok(citations.length >= n, `expected >= ${n} citations, got ${citations.length}`);
});
