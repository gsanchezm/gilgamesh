import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { CreateFeature, DeleteFeature, GetFeature, ListFeatures, UpdateFeature } from './testlab-features';

const GHERKIN = `Feature: Checkout
  Scenario: Pay with card
    When I pay
  Scenario: Pay with cash
    When I pay cash
`;

describe('Test Lab — feature authoring', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const onboarded = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = onboarded.orgId;
    projectId = onboarded.projectId;
  });

  it('creates a feature and parses its scenarios (AC-FEAT-01)', async () => {
    const f = await new CreateFeature(ctx).execute({ userId, projectId, path: 'checkout.feature', content: GHERKIN });
    expect(f.name).toBe('Checkout');
    expect(f.scenarios.map((s) => s.name)).toEqual(['Pay with card', 'Pay with cash']);
    expect(f.scenarios.every((s) => s.lastStatus === null)).toBe(true);
    expect(ctx.audit.rows.find((r) => r.action === 'feature.created')?.metadata.scenarioCount).toBe(2);
  });

  it('lists features with a scenario count and reads one with its scenarios (AC-FEAT-02/03)', async () => {
    const created = await new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN });
    const list = await new ListFeatures(ctx).execute({ userId, projectId });
    expect(list).toEqual([{ id: created.id, name: 'Checkout', path: 'a.feature', sliceId: null, scenarioCount: 2 }]);
    const read = await new GetFeature(ctx).execute({ userId, featureId: created.id });
    expect(read.scenarios.map((s) => s.name)).toEqual(['Pay with card', 'Pay with cash']);
  });

  it('re-parses scenarios when the content is edited (AC-FEAT-04)', async () => {
    const f = await new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN });
    const updated = await new UpdateFeature(ctx).execute({
      userId,
      featureId: f.id,
      content: 'Feature: Checkout v2\n  Scenario: Only one\n    Then ok\n',
    });
    expect(updated.name).toBe('Checkout v2');
    expect(updated.scenarios.map((s) => s.name)).toEqual(['Only one']);
    const read = await new GetFeature(ctx).execute({ userId, featureId: f.id });
    expect(read.scenarios.map((s) => s.name)).toEqual(['Only one']);
  });

  it('rejects invalid gherkin with VALIDATION (AC-FEAT-05)', async () => {
    await expect(
      new CreateFeature(ctx).execute({ userId, projectId, path: 'bad.feature', content: 'Feature: Empty\n  Background:\n    Given x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('deletes a feature and its scenarios (AC-FEAT-06)', async () => {
    const f = await new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN });
    await new DeleteFeature(ctx).execute({ userId, featureId: f.id });
    await expect(new GetFeature(ctx).execute({ userId, featureId: f.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await ctx.scenarios.listForFeature(f.id)).toEqual([]);
  });

  it('rejects a slice that belongs to another project (AC-FEAT-07)', async () => {
    await expect(
      new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN, sliceId: 'nope' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('enforces tenant isolation (AC-FEAT-08)', async () => {
    const f = await new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN });
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(new GetFeature(ctx).execute({ userId: outsider, featureId: f.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets a VIEWER read but not author (AC-FEAT-09)', async () => {
    const f = await new CreateFeature(ctx).execute({ userId, projectId, path: 'a.feature', content: GHERKIN });
    const viewer = (
      await new RegisterUser(ctx).execute({ firstName: 'V', lastName: 'R', email: 'viewer@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    await ctx.memberships.create({ id: ctx.ids.next(), orgId, userId: viewer, role: 'VIEWER', createdAt: ctx.clock.now() });

    expect((await new GetFeature(ctx).execute({ userId: viewer, featureId: f.id })).scenarios.length).toBe(2);
    await expect(
      new CreateFeature(ctx).execute({ userId: viewer, projectId, path: 'v.feature', content: GHERKIN }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
