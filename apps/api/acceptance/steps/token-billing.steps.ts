import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { GilgameshWorld } from '../support/world';

/** Slice 14 — AI Brain token allowances (AC-TOKB-01..07). */

function server(world: GilgameshWorld) {
  return request(world.app.getHttpServer());
}

function body(world: GilgameshWorld): Record<string, unknown> {
  return (world.response?.body ?? {}) as Record<string, unknown>;
}

async function tokensUsed(world: GilgameshWorld): Promise<number> {
  const sub = await world.db.subscription.findUnique({ where: { orgId: world.lastOrgId! } });
  assert.ok(sub, 'no subscription row for the current org');
  return sub.brainTokensUsed;
}

/** The most recent AGENT answer of the current session (mirrors chat.steps/brain.steps). */
async function lastAgentMessage(world: GilgameshWorld) {
  const sessionId = world.notes.get('chatSessionId') as string;
  const msg = await world.db.chatMessage.findFirst({
    where: { sessionId, role: 'AGENT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(msg, `no AGENT message in session ${sessionId}`);
  return msg;
}

// ---- Exhausting / observing the counter -------------------------------------------------------

Given("my org's subscription has no AI tokens remaining", async function (this: GilgameshWorld) {
  // >= any metered quota (FREE 100k … GROWTH 10M) and == the SCALE storage cap, whose
  // brainTokensUnlimited flag must still bypass blocking (AC-TOKB-06).
  await this.db.subscription.updateMany({
    where: { orgId: this.lastOrgId! },
    data: { brainTokensUsed: 1_000_000_000 },
  });
});

Given("I note the org's AI tokens used", async function (this: GilgameshWorld) {
  this.notes.set('brainTokensUsed', await tokensUsed(this));
});

Then("the org's AI tokens used is unchanged", async function (this: GilgameshWorld) {
  const noted = this.notes.get('brainTokensUsed') as number;
  assert.equal(await tokensUsed(this), noted, 'brainTokensUsed changed unexpectedly');
});

Then('the org has used at least {int} AI token(s)', async function (this: GilgameshWorld, n: number) {
  const used = await tokensUsed(this);
  assert.ok(used >= n, `expected brainTokensUsed >= ${n}, got ${used}`);
});

// ---- The subscription view fields --------------------------------------------------------------

Then('the subscription AI token quota is {int}', function (this: GilgameshWorld, quota: number) {
  assert.equal(body(this).brainTokensQuota, quota);
});

Then('the subscription AI tokens used is {int}', function (this: GilgameshWorld, used: number) {
  assert.equal(body(this).brainTokensUsed, used);
});

// ---- Charge reconciliation (billable = input + output; cache excluded) --------------------------

Then(
  "the org's AI tokens used equals the billable sum of its BrainUsage rows",
  async function (this: GilgameshWorld) {
    const rows = await this.db.brainUsage.findMany({ where: { orgId: this.lastOrgId! } });
    assert.ok(rows.length > 0, 'no BrainUsage rows to reconcile against');
    const billable = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);
    assert.equal(
      await tokensUsed(this),
      billable,
      `brainTokensUsed diverged from the billable row sum (${billable})`,
    );
  },
);

Given("I note the org's BrainUsage row count", async function (this: GilgameshWorld) {
  this.notes.set('brainUsageCount', await this.db.brainUsage.count({ where: { orgId: this.lastOrgId! } }));
});

Then("the org's BrainUsage row count is unchanged", async function (this: GilgameshWorld) {
  const noted = this.notes.get('brainUsageCount') as number;
  const now = await this.db.brainUsage.count({ where: { orgId: this.lastOrgId! } });
  assert.equal(now, noted, `expected no new BrainUsage rows, found ${now - noted}`);
});

// ---- Narrated chat block (AC-TOKB-05/06) --------------------------------------------------------

Then('the chat narrates an AI token allowance outcome', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this);
  assert.ok(/token allowance/i.test(msg.content), `no token-allowance narration: ${msg.content}`);
});

Then('the chat does not narrate an AI token allowance outcome', async function (this: GilgameshWorld) {
  const msg = await lastAgentMessage(this);
  assert.ok(!/token allowance/i.test(msg.content), `unexpected token-allowance narration: ${msg.content}`);
});

// ---- Knowledge document upload (the org-attributed EMBED surface) -------------------------------

When(
  'I upload a knowledge document named {string} with QA content',
  async function (this: GilgameshWorld, name: string) {
    this.response = await this.applyAuth(
      server(this).post(`${this.basePath}/orgs/${this.lastOrgId}/knowledge/documents`),
    ).send({
      name,
      type: 'md',
      content: '# Notes\n\nBoundary value analysis picks the edges of each equivalence class.',
    });
  },
);
