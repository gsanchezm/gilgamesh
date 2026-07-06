import { beforeEach, describe, expect, it } from 'vitest';
import { hasBrainForOrg, type AgentBrainPort, type BrainCompleteRequest } from '../ports/brain';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CreateChatSession, SendChatMessage } from './chat';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { TriggerRun } from './runs';
import { GenerateDrafts } from './testlab-generate';
import { CreateTestCase } from './testlab-testcases';

/**
 * S9 follow-up (org-BYOK call-time resolution): consumers whose bound brain exposes the OPTIONAL
 * `forOrg` extension must use the org-scoped instance for every complete/stream; adapters without
 * it (the stub in every other unit test) keep the old path untouched.
 */

/** A base brain that must never answer itself; `forOrg` hands out the org-scoped instance. */
function makeOrgScopedBrain(orgBrain: AgentBrainPort) {
  const forOrgCalls: string[] = [];
  const base: AgentBrainPort & { forOrg(orgId: string): AgentBrainPort } = {
    complete: async () => {
      throw new Error('the base brain must not complete when forOrg exists');
    },
    stream: () => {
      throw new Error('the base brain must not stream when forOrg exists');
    },
    embed: async (texts) => texts.map(() => [0]),
    forOrg: (orgId) => {
      forOrgCalls.push(orgId);
      return orgBrain;
    },
  };
  return { base, forOrgCalls };
}

describe('org-scoped brain resolution (S9 follow-up — hasBrainForOrg/forOrg)', () => {
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

  it('hasBrainForOrg detects the optional extension (the streamWithUsage precedent)', () => {
    expect(hasBrainForOrg(ctx.brain)).toBe(false); // DeterministicBrain -> the old direct path
    const { base } = makeOrgScopedBrain(ctx.brain);
    expect(hasBrainForOrg(base)).toBe(true);
  });

  it('SendChatMessage routes AND answers via brain.forOrg(project.orgId)', async () => {
    const orgCompletes: BrainCompleteRequest[] = [];
    const orgBrain: AgentBrainPort = {
      complete: async (req) => {
        orgCompletes.push(req);
        return { text: '{"slot":"perf","confidence":0.95}', usage: { inputTokens: 1, outputTokens: 1 } };
      },
      stream: () =>
        (async function* () {
          yield { delta: 'org-scoped answer' };
        })(),
      embed: async (texts) => texts.map(() => [0]),
    };
    const { base, forOrgCalls } = makeOrgScopedBrain(orgBrain);
    const send = new SendChatMessage({
      ...ctx,
      brain: base,
      tools: {
        triggerRun: new TriggerRun(ctx),
        createTestCase: new CreateTestCase(ctx),
        generateDrafts: new GenerateDrafts(ctx),
      },
    });
    const session = await new CreateChatSession(ctx).execute({ userId, projectId });

    const res = await send.execute({ userId, sessionId: session.id, content: 'how should we load test the api?' });

    expect(forOrgCalls).toEqual([orgId]); // resolved ONCE per send, with the project's org
    expect(orgCompletes[0]?.system).toContain('router'); // the HAIKU classify went to the org brain
    expect(res.answer.content).toBe('org-scoped answer'); // ...and so did the answer stream
  });

  it('GenerateDrafts completes via brain.forOrg(project.orgId)', async () => {
    const orgBrain: AgentBrainPort = {
      complete: async () => ({
        text: JSON.stringify({
          features: [{ name: 'Org Feature', path: 'features/org.feature', content: 'Feature: Org Feature\n' }],
          testCases: [],
        }),
        usage: { inputTokens: 2, outputTokens: 3 },
      }),
      stream: () => {
        throw new Error('GenerateDrafts never streams');
      },
      embed: async (texts) => texts.map(() => [0]),
    };
    const { base, forOrgCalls } = makeOrgScopedBrain(orgBrain);

    const drafts = await new GenerateDrafts({ ...ctx, brain: base }).execute({ userId, projectId, prompt: 'checkout' });

    expect(forOrgCalls).toEqual([orgId]);
    expect(drafts.features.map((f) => f.name)).toEqual(['Org Feature']);
  });
});
