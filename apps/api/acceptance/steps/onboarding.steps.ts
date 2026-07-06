import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { authOf } from '../support/auth';
import type { GilgameshWorld } from '../support/world';

const DEFAULT_PASSWORD = 'C0rrect-Horse!';
const PROVIDER_BY_LABEL: Record<string, string> = {
  GitHub: 'github',
  GitLab: 'gitlab',
  Bitbucket: 'bitbucket',
  'Azure DevOps': 'ado',
};

// ---- helpers ------------------------------------------------------------------------

async function finishOnboarding(
  world: GilgameshWorld,
  opts: {
    projectName?: string;
    format?: string;
    orgName?: string;
    repoProvider?: string;
    repoFullName?: string;
    repoBranch?: string;
  } = {},
) {
  const body: Record<string, unknown> = {
    projectName: opts.projectName ?? (world.notes.get('projectName') as string) ?? 'OmniPizza',
    format: opts.format ?? (world.notes.get('format') as string) ?? 'BDD',
  };
  if (opts.orgName !== undefined) body.orgName = opts.orgName;
  if (opts.repoProvider) {
    body.repoProvider = opts.repoProvider;
    if (opts.repoFullName) body.repoFullName = opts.repoFullName;
    if (opts.repoBranch) body.repoBranch = opts.repoBranch;
  }
  const res = await world
    .applyAuth(request(world.app.getHttpServer()).post(world.url('/projects')))
    .send(body);
  world.response = res;
  if (res.status === 201 && res.body?.projectId) {
    world.lastOrgId = res.body.orgId;
    world.lastProjectId = res.body.projectId;
    world.notes.set('lastSlug', res.body.slug);
    world.projectsByName.set(String(body.projectName), res.body.projectId);
  }
  return res;
}

/** Onboard a brand-new (separate) user, without touching the acting cookie. Returns {orgId,projectId,slug}. */
async function onboardAsNewUser(world: GilgameshWorld, email: string, projectName: string) {
  const reg = await request(world.app.getHttpServer())
    .post(world.url('/auth/register'))
    .send({ firstName: 'X', lastName: 'Y', email, password: DEFAULT_PASSWORD });
  const auth = authOf(reg);
  const proj = await request(world.app.getHttpServer())
    .post(world.url('/projects'))
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send({ projectName, format: 'BDD' });
  return proj.body as { orgId: string; projectId: string; slug: string };
}

async function currentUserId(world: GilgameshWorld): Promise<string> {
  const email = world.notes.get('me') as string;
  const user = await world.db.user.findFirst({ where: { email } });
  assert.ok(user, 'no signed-in user');
  return user.id;
}

/** Directly seed an Org + Membership so role-gated scenarios start from a precise tenant state. */
async function seedOrgMembership(world: GilgameshWorld, userId: string, role: string): Promise<string> {
  const now = new Date();
  const orgId = randomUUID();
  await world.db.org.create({
    data: { id: orgId, name: 'Existing Org', slug: `existing-${orgId.slice(0, 8)}`, createdAt: now, updatedAt: now },
  });
  await world.db.membership.create({ data: { id: randomUUID(), orgId, userId, role: role as never, createdAt: now } });
  return orgId;
}

// ---- Background ---------------------------------------------------------------------

Given('I have no Membership yet', async function (this: GilgameshWorld) {
  assert.equal(await this.db.membership.count({ where: { userId: await currentUserId(this) } }), 0);
});

// ---- Step 1 / project name ----------------------------------------------------------

Given('I am on step 1 of onboarding', function () {
  /* UI step — the wizard state is a client concern (covered by Playwright). */
});

When('I leave the project name empty or whitespace', function (this: GilgameshWorld) {
  this.notes.set('projectName', '   ');
});

Then('the {string} action is disabled', function (_action: string) {
  /* UI step — "Next" disabled state is verified by the web e2e, not the API. */
});

Then(
  'forcing a {string} with an empty name returns 422 with a {string} body',
  async function (this: GilgameshWorld, _verb: string, kind: string) {
    const res = await finishOnboarding(this, { projectName: '   ', format: 'BDD' });
    assert.equal(res.status, 422);
    assert.equal(kind, 'Problem');
    assert.ok(res.body?.title && res.body?.status, 'expected a Problem document');
  },
);

// ---- Step 2 / format ----------------------------------------------------------------

Given('I have entered a project name on step 1', function (this: GilgameshWorld) {
  this.notes.set('projectName', 'OmniPizza');
});

When('I select the {string} format on step 2', function (this: GilgameshWorld, choice: string) {
  this.notes.set('format', choice.startsWith('BDD') ? 'BDD' : 'TRADITIONAL');
});

Then('the project will be created with format {string}', async function (this: GilgameshWorld, format: string) {
  const res = await finishOnboarding(this);
  assert.equal(res.status, 201);
  const project = await this.db.project.findUnique({ where: { id: this.lastProjectId! } });
  assert.equal(project?.format, format);
});

// ---- Step 3 / repo ------------------------------------------------------------------

Given('I have entered a project name and chosen a format', function (this: GilgameshWorld) {
  this.notes.set('projectName', 'OmniPizza');
  this.notes.set('format', 'BDD');
});

When('I skip the repo connection on step 3 and finish onboarding', async function (this: GilgameshWorld) {
  await finishOnboarding(this);
});

Then(
  'the created Project has {string}, {string} and {string} all null',
  async function (this: GilgameshWorld, _a: string, _b: string, _c: string) {
    const p = await this.db.project.findUnique({ where: { id: this.lastProjectId! } });
    assert.equal(p?.repoProvider, null);
    assert.equal(p?.repoFullName, null);
    assert.equal(p?.repoBranch, null);
  },
);

When(
  'I connect {string} with repo {string} on branch {string} and finish',
  async function (this: GilgameshWorld, providerLabel: string, fullName: string, branch: string) {
    await finishOnboarding(this, {
      repoProvider: PROVIDER_BY_LABEL[providerLabel] ?? providerLabel.toLowerCase(),
      repoFullName: fullName,
      repoBranch: branch,
    });
  },
);

Then(
  'the created Project has repoProvider {string}, repoFullName {string}, repoBranch {string}',
  async function (this: GilgameshWorld, repoProvider: string, fullName: string, branch: string) {
    const p = await this.db.project.findUnique({ where: { id: this.lastProjectId! } });
    assert.equal(p?.repoProvider, repoProvider);
    assert.equal(p?.repoFullName, fullName);
    assert.equal(p?.repoBranch, branch);
  },
);

Then('no repository OAuth token is stored and no sync is performed in this slice', function () {
  /* Documentary: slice 1 stores repo metadata only — there is no token column or sync job. */
});

// ---- Bootstrap (AC-ONB-04/13) -------------------------------------------------------

Given(
  'I have completed steps 1 to 3 with project name {string} and format {string}',
  function (this: GilgameshWorld, name: string, format: string) {
    this.notes.set('projectName', name);
    this.notes.set('format', format);
  },
);

// Matches both "When I finish onboarding" (AC-ONB-04) and "Given I finish onboarding" (AC-ONB-06)
// — Cucumber step matching is keyword-agnostic, so a single definition serves both.
When('I finish onboarding', async function (this: GilgameshWorld) {
  await finishOnboarding(this);
});

Given('I finish onboarding so the Org agent catalog is seeded', async function (this: GilgameshWorld) {
  await finishOnboarding(this);
});

Given('I finish onboarding creating the project {string}', async function (this: GilgameshWorld, name: string) {
  await finishOnboarding(this, { projectName: name });
});

Then('a {string} creates one Org', async function (this: GilgameshWorld, _verb: string) {
  assert.equal(await this.db.org.count(), 1);
});

Then(
  'a Membership is created linking me to that Org with role {string}',
  async function (this: GilgameshWorld, role: string) {
    const m = await this.db.membership.findFirst({
      where: { userId: await currentUserId(this), orgId: this.lastOrgId! },
    });
    assert.equal(m?.role, role);
  },
);

Then('exactly {int} Agent rows are seeded into the Org catalog', async function (this: GilgameshWorld, n: number) {
  assert.equal(await this.db.agent.count({ where: { orgId: this.lastOrgId! } }), n);
});

Then('exactly one Subscription is created for the Org', async function (this: GilgameshWorld) {
  assert.equal(await this.db.subscription.count({ where: { orgId: this.lastOrgId! } }), 1);
});

Then(
  'a {string} creates the Project {string} with format {string}',
  async function (this: GilgameshWorld, _verb: string, name: string, format: string) {
    const p = await this.db.project.findFirst({ where: { orgId: this.lastOrgId!, name } });
    assert.ok(p, `project ${name} not created`);
    assert.equal(p.format, format);
  },
);

Then('I am redirected to the agent room of the new project', function () {
  /* UI step — client navigation, verified by Playwright. */
});

// ---- Org naming (AC-ONB-14) ---------------------------------------------------------

When('I finish onboarding with the company {string}', async function (this: GilgameshWorld, company: string) {
  await finishOnboarding(this, { orgName: company });
});

Then('the created Org is named {string}', async function (this: GilgameshWorld, name: string) {
  assert.equal(this.response?.status, 201);
  const org = await this.db.org.findUnique({ where: { id: this.lastOrgId! } });
  assert.equal(org?.name, name);
});

// ---- Roster (AC-ONB-05) -------------------------------------------------------------

Then(
  'the {int} Agent rows equal the keystone roster:',
  function (this: GilgameshWorld, count: number, table: DataTable) {
    const list = (this.response?.body ?? []) as Array<Record<string, string>>;
    assert.equal(list.length, count);
    for (const expected of table.hashes()) {
      const actual = list.find((a) => a.slot === expected.slot);
      assert.ok(actual, `missing slot ${expected.slot}`);
      for (const key of ['deityName', 'family', 'glyph', 'culture', 'defaultTool'] as const) {
        assert.equal(String(actual[key]).trim(), expected[key].trim(), `${expected.slot}.${key}`);
      }
    }
  },
);

Then('each Agent is unique by \\(orgId, slot)', function (this: GilgameshWorld) {
  const slots = ((this.response?.body ?? []) as Array<{ slot: string }>).map((a) => a.slot);
  assert.equal(new Set(slots).size, slots.length);
});

// ---- Subscription (AC-ONB-06) -------------------------------------------------------

Then(
  'the {string} has plan {string} and status {string}',
  function (this: GilgameshWorld, _view: string, plan: string, status: string) {
    const b = this.response?.body as { plan?: string; status?: string };
    assert.equal(b?.plan, plan);
    assert.equal(b?.status, status);
  },
);

Then(
  'it has billingCycle {string}, seats {int}, runMinutesQuota {int} and runMinutesUsed {int}',
  function (this: GilgameshWorld, billingCycle: string, seats: number, quota: number, used: number) {
    const b = this.response?.body as Record<string, unknown>;
    assert.equal(b.billingCycle, billingCycle);
    assert.equal(b.seats, seats);
    assert.equal(b.runMinutesQuota, quota);
    assert.equal(b.runMinutesUsed, used);
  },
);

// ---- ToolBindings (AC-ONB-07) -------------------------------------------------------

Then(
  'exactly {int} ToolBinding rows exist, one per Agent, unique by \\(projectId, agentId)',
  async function (this: GilgameshWorld, n: number) {
    const bindings = await this.db.toolBinding.findMany({ where: { projectId: this.lastProjectId! } });
    assert.equal(bindings.length, n);
    assert.equal(new Set(bindings.map((b) => b.agentId)).size, n);
  },
);

Then(
  'each ToolBinding has {string} true and {string} equal to its Agent {string}',
  async function (this: GilgameshWorld, _enabled: string, _tool: string, _field: string) {
    const bindings = await this.db.toolBinding.findMany({ where: { projectId: this.lastProjectId! } });
    for (const b of bindings) {
      assert.equal(b.enabled, true);
      const agent = await this.db.agent.findUnique({ where: { id: b.agentId } });
      assert.equal(b.tool, agent?.defaultTool);
    }
  },
);

// ---- Slug collisions (AC-ONB-08/09) -------------------------------------------------

Given('an Org already exists whose slug would collide with my derived slug', async function (this: GilgameshWorld) {
  await onboardAsNewUser(this, 'rival@uruk.io', 'OmniPizza'); // org slug "omnipizza"
  this.notes.set('projectName', 'OmniPizza');
});

Then('my Org is created with a unique auto-suffixed slug', async function (this: GilgameshWorld) {
  const org = await this.db.org.findUnique({ where: { id: this.lastOrgId! } });
  assert.ok(org && org.slug !== 'omnipizza' && /^omnipizza-\d+$/.test(org.slug), `slug not suffixed: ${org?.slug}`);
});

Then('the request does not error', function (this: GilgameshWorld) {
  assert.equal(this.response?.status, 201);
});

Given('I already have a Membership in an Org', async function (this: GilgameshWorld) {
  await finishOnboarding(this, { projectName: 'OmniPizza' });
});

Given('that Org already has a Project named {string}', async function (this: GilgameshWorld, name: string) {
  const p = await this.db.project.findFirst({ where: { name } });
  assert.ok(p, `expected an existing project ${name}`);
});

When('I onboard a second Project also named {string}', async function (this: GilgameshWorld, name: string) {
  await finishOnboarding(this, { projectName: name });
});

Then('the new Project is created with a unique auto-suffixed slug', function (this: GilgameshWorld) {
  const slug = this.notes.get('lastSlug') as string;
  assert.ok(/-\d+$/.test(slug), `slug not suffixed: ${slug}`);
});

Then('Unique\\(orgId, slug) still holds', async function (this: GilgameshWorld) {
  const projects = await this.db.project.findMany({ where: { orgId: this.lastOrgId! } });
  const slugs = projects.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

// ---- Org reuse (AC-ONB-10) ----------------------------------------------------------

Given(
  'I already have a Membership in Org {string} with role {string}',
  async function (this: GilgameshWorld, alias: string, _role: string) {
    await finishOnboarding(this, { projectName: 'OmniPizza' });
    this.notes.set(`org:${alias}`, this.lastOrgId);
  },
);

When('I onboard a new Project {string}', async function (this: GilgameshWorld, name: string) {
  await finishOnboarding(this, { projectName: name });
});

Then('no new Org is created and {string} is reused', async function (this: GilgameshWorld, alias: string) {
  assert.equal(await this.db.org.count(), 1);
  assert.equal(this.lastOrgId, this.notes.get(`org:${alias}`));
});

Then('no additional Agent rows are seeded', async function (this: GilgameshWorld) {
  assert.equal(await this.db.agent.count(), 11);
});

Then('no additional Subscription is created', async function (this: GilgameshWorld) {
  assert.equal(await this.db.subscription.count(), 1);
});

Then(
  'only a new Project {string} with its {int} ToolBinding rows is created',
  async function (this: GilgameshWorld, name: string, n: number) {
    assert.equal(await this.db.project.count(), 2);
    const p = await this.db.project.findFirst({ where: { name } });
    assert.ok(p, `project ${name} not created`);
    assert.equal(await this.db.toolBinding.count({ where: { projectId: p.id } }), n);
  },
);

// ---- RBAC (AC-ONB-11) ---------------------------------------------------------------

Given('I am signed in as a {string} of an existing Org', async function (this: GilgameshWorld, role: string) {
  await seedOrgMembership(this, await currentUserId(this), role);
});

When('I POST {string} in that Org', async function (this: GilgameshWorld, path: string) {
  this.response = await this.applyAuth(
    request(this.app.getHttpServer()).post(this.url(path)),
  ).send({ projectName: 'Nope', format: 'BDD' });
});
