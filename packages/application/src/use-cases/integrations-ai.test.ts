import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { ConnectIntegration, DisconnectIntegration, ListIntegrations } from './integrations';
import { RegisterUser } from './register-user';

describe('AI provider BYOK — anthropic integration (AC-BYOK-*)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    orgId = (await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' })).orgId;
  });

  it('lists anthropic in the catalog under AI_PROVIDERS, disconnected (AC-BYOK-01)', async () => {
    const list = await new ListIntegrations(ctx).execute({ userId, orgId });
    const anthropic = list.find((i) => i.key === 'anthropic');
    expect(anthropic).toMatchObject({ group: 'AI_PROVIDERS', connected: false });
  });

  it('connect verifies, vaults a secretRef and discards the raw key (AC-BYOK-02)', async () => {
    const view = await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'anthropic', token: 'sk-ant-test-123' });
    expect(view).toMatchObject({ key: 'anthropic', group: 'AI_PROVIDERS', connected: true });

    const row = await ctx.integrations.findByKey(orgId, 'anthropic');
    expect(row?.secretRef).toBeTruthy();
    const everything = JSON.stringify([row, ctx.audit.rows]);
    expect(everything).not.toContain('sk-ant-test-123');
  });

  it('rejects an invalid key with VALIDATION and stores nothing (AC-BYOK-02)', async () => {
    await expect(
      new ConnectIntegration(ctx).execute({ userId, orgId, key: 'anthropic', token: 'invalid' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await ctx.integrations.findByKey(orgId, 'anthropic'))?.connected ?? false).toBe(false);
  });

  it('disconnect clears the connection (AC-BYOK-03)', async () => {
    await new ConnectIntegration(ctx).execute({ userId, orgId, key: 'anthropic', token: 'sk-ant-ok' });
    const view = await new DisconnectIntegration(ctx).execute({ userId, orgId, key: 'anthropic' });
    expect(view.connected).toBe(false);
    expect((await ctx.integrations.findByKey(orgId, 'anthropic'))?.secretRef).toBeNull();
  });

  it('only OWNER/ADMIN manage the key (AC-BYOK-03)', async () => {
    const member = (
      await new RegisterUser(ctx).execute({ firstName: 'M', lastName: 'B', email: 'member@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: member, role: 'MEMBER', createdAt: ctx.clock.now() });
    await expect(
      new ConnectIntegration(ctx).execute({ userId: member, orgId, key: 'anthropic', token: 'sk-ant-x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
