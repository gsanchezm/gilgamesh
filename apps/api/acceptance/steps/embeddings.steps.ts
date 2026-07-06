import type { EmbeddingKind, KindAwareEmbeddingBrain } from '@gilgamesh/application';
import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TOKENS } from '../../src/persistence/tokens';
import type { GilgameshWorld } from '../support/world';

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

// ---- Dimension (AC-EMB-01) -----------------------------------------------------------------

Then(
  'every stored knowledge embedding has {int} dimensions',
  async function (this: GilgameshWorld, dims: number) {
    // vector_dims() reads the ACTUAL stored pgvector payload — not the declared column type — so this
    // proves the ingest path really wrote 1024-dim vectors into the v0.5 vector(1024) column.
    const rows = await this.db.$queryRaw<{ dims: number }[]>`
      SELECT DISTINCT vector_dims(embedding) AS dims FROM knowledge_chunks`;
    assert.ok(rows.length > 0, 'no knowledge chunks stored');
    assert.deepEqual(
      rows.map((r) => Number(r.dims)),
      [dims],
      `stored embedding dimensions are ${rows.map((r) => r.dims).join(', ')}, expected only ${dims}`,
    );
  },
);

Then('embeddings are served by the offline lexical stub', function (this: GilgameshWorld) {
  // The harness runs BRAIN_MODE=offline with no VOYAGE_API_KEY; the bound brain must self-report
  // the lexical embedding selection (the S9 `mode` self-report pattern, for the embed path).
  const brain = this.app.get(TOKENS.Brain) as { embeddings?: string };
  assert.equal(brain.embeddings, 'lexical', `expected lexical embeddings, got ${brain.embeddings}`);
});

// ---- Per-org document upload (reused by the metering scenarios) ------------------------------

When(
  'I upload the knowledge document {string} with content {string}',
  async function (this: GilgameshWorld, name: string, content: string) {
    const type = name.includes('.') ? name.split('.').pop()! : 'txt';
    this.response = await this.applyAuth(
      server(this).post(`${this.basePath}/orgs/${this.lastOrgId}/knowledge/documents`),
    ).send({ name, type, content });
  },
);

// ---- EMBED metering (AC-EMB-05) --------------------------------------------------------------

Then(
  'my org has an EMBED usage row with counted input tokens and zero output tokens',
  async function (this: GilgameshWorld) {
    const row = await this.db.brainUsage.findFirst({
      where: { orgId: this.lastOrgId!, surface: 'EMBED' as never },
    });
    assert.ok(row, 'no BrainUsage row with surface=EMBED');
    assert.equal(row.tier, 'HAIKU', `EMBED rows pin the nominal HAIKU tier, got ${row.tier}`);
    assert.ok(row.inputTokens > 0, `EMBED row carries no counted tokens (inputTokens=${row.inputTokens})`);
    assert.equal(row.outputTokens, 0, 'an embedding call produces no output tokens');
  },
);

// ---- input_type kind threading (AC-EMB-04) ----------------------------------------------------

Given('embedding kinds are being recorded', function (this: GilgameshWorld) {
  // Behavior-preserving spy on the bound brain's optional embedAs extension (the patchStreamOnce
  // precedent): records each kind, then delegates. Restored by the asserting Then step.
  const brain = this.app.get(TOKENS.Brain) as KindAwareEmbeddingBrain;
  assert.equal(typeof brain.embedAs, 'function', 'the bound brain lacks the embedAs extension');
  const original = brain.embedAs.bind(brain);
  const kinds: EmbeddingKind[] = [];
  (brain as { embedAs: KindAwareEmbeddingBrain['embedAs'] }).embedAs = (texts, kind) => {
    kinds.push(kind);
    return original(texts, kind);
  };
  this.notes.set('embedKinds', kinds);
  this.notes.set('restoreEmbedAs', () => {
    (brain as { embedAs: KindAwareEmbeddingBrain['embedAs'] }).embedAs = original;
  });
});

Then(
  'the recorded embedding kinds include {string} and {string}',
  function (this: GilgameshWorld, a: string, b: string) {
    // Restore FIRST (the app instance is shared across scenarios), then assert.
    (this.notes.get('restoreEmbedAs') as () => void)();
    const kinds = this.notes.get('embedKinds') as string[];
    assert.ok(kinds.includes(a), `no "${a}" embed recorded (got: ${kinds.join(', ') || 'none'})`);
    assert.ok(kinds.includes(b), `no "${b}" embed recorded (got: ${kinds.join(', ') || 'none'})`);
  },
);
