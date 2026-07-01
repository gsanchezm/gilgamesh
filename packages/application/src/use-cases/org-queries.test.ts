import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { GetOrgSubscription, ListOrgAgents } from './org-queries';
import { RegisterUser } from './register-user';

const ROSTER_SLOTS = [
  'lead',
  'arch',
  'manual',
  'web',
  'api',
  'android',
  'ios',
  'perf',
  'visual',
  'sec',
  'a11y',
];

describe('Org queries', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({
        firstName: 'I',
        lastName: 'U',
        email: 'owner@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
    orgId = (
      await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })
    ).orgId;
  });

  async function outsider(): Promise<string> {
    return (
      await new RegisterUser(ctx).execute({
        firstName: 'E',
        lastName: 'X',
        email: 'eve@uruk.io',
        password: 'C0rrect-Horse!',
      })
    ).userId;
  }

  describe('ListOrgAgents', () => {
    it('returns the canonical 11 agents in roster order for a member', async () => {
      const agents = await new ListOrgAgents(ctx).execute({ userId, orgId });
      expect(agents).toHaveLength(11);
      expect(agents.map((a) => a.slot)).toEqual(ROSTER_SLOTS);
      expect(agents[0]).toMatchObject({ slot: 'lead', toolOptions: expect.any(Array) });
    });

    it('returns NOT_FOUND for a non-member (tenant isolation)', async () => {
      await expect(new ListOrgAgents(ctx).execute({ userId: await outsider(), orgId })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });
  });

  describe('GetOrgSubscription', () => {
    it('returns the seeded FREE trial subscription for a member', async () => {
      const sub = await new GetOrgSubscription(ctx).execute({ userId, orgId });
      expect(sub).toMatchObject({
        plan: 'FREE',
        status: 'TRIALING',
        billingCycle: 'MONTHLY',
        seats: 1,
        runMinutesQuota: 500,
        runMinutesUsed: 0,
      });
    });

    it('returns NOT_FOUND for a non-member', async () => {
      await expect(
        new GetOrgSubscription(ctx).execute({ userId: await outsider(), orgId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
