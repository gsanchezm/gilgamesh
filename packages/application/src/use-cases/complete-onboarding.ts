import { AGENT_ROSTER, Slug } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { ProjectFormat } from '../ports/records';
import type { Repositories, UnitOfWork } from '../ports/unit-of-work';

const DEFAULT_SLICES = [
  { key: 'checkout', name: 'Checkout', order: 1 },
  { key: 'login', name: 'Login', order: 2 },
  { key: 'catalog', name: 'Catalog', order: 3 },
  { key: 'payments', name: 'Payments', order: 4 },
  { key: 'imported', name: 'Imported', order: 5 },
] as const;

const TRIAL_DAYS = 14;

export interface CompleteOnboardingInput {
  userId: string;
  projectName: string;
  format: ProjectFormat;
  repoProvider?: string;
  repoFullName?: string;
  repoBranch?: string;
}

export interface CompleteOnboardingResult {
  orgId: string;
  projectId: string;
  slug: string;
}

export interface CompleteOnboardingDeps {
  uow: UnitOfWork;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Finishes onboarding. On a user's FIRST project this bootstraps the tenant — Org + OWNER
 * Membership + the 11-agent catalog + a FREE trial Subscription — then creates the Project,
 * its default vertical slices and a per-agent ToolBinding (all awake). On a subsequent project
 * the existing Org is reused (no new Org/agents/subscription). All 11 bindings start enabled
 * (spec AC-ONB-07 / AC-ROOM-03).
 */
export class CompleteOnboarding {
  constructor(private readonly deps: CompleteOnboardingDeps) {}

  async execute(input: CompleteOnboardingInput): Promise<CompleteOnboardingResult> {
    if (!input.projectName.trim()) {
      throw new ApplicationError('VALIDATION', 'Project name is required.');
    }

    const now = this.deps.clock.now();
    // The whole bootstrap + project creation is one transaction: a partial failure rolls back
    // entirely, so no corrupt half-provisioned tenant is ever left behind (spec AC-ONB-12).
    return this.deps.uow.transaction(async (repos) => {
      const existing = await repos.memberships.listForUser(input.userId);
      const orgId = existing[0]?.orgId ?? (await this.bootstrapTenant(repos, input, now));

      if (existing.length > 0) {
        const role = existing[0]!.role;
        if (role !== 'OWNER' && role !== 'ADMIN') {
          throw new ApplicationError('FORBIDDEN', 'Only owners or admins can create projects.');
        }
      }

      const slug = await this.uniqueProjectSlug(repos, orgId, Slug.fromName(input.projectName).value);
      const projectId = this.deps.ids.next();
      await repos.projects.create({
        id: projectId,
        orgId,
        name: input.projectName.trim(),
        slug,
        format: input.format,
        repoProvider: input.repoProvider ?? null,
        repoFullName: input.repoFullName ?? null,
        repoBranch: input.repoBranch ?? null,
        repoCommit: null,
        repoLastSyncAt: null,
        createdAt: now,
        updatedAt: now,
      });

      await repos.slices.createMany(
        DEFAULT_SLICES.map((s) => ({
          id: this.deps.ids.next(),
          orgId,
          projectId,
          key: s.key,
          name: s.name,
          order: s.order,
        })),
      );

      const orgAgents = await repos.agents.listForOrg(orgId);
      await repos.toolBindings.createMany(
        orgAgents.map((a) => ({
          id: this.deps.ids.next(),
          orgId,
          projectId,
          agentId: a.id,
          tool: a.defaultTool,
          enabled: true,
          updatedAt: now,
        })),
      );

      await repos.audit.append({
        id: this.deps.ids.next(),
        orgId,
        actorUserId: input.userId,
        action: 'project.created',
        targetType: 'Project',
        targetId: projectId,
        metadata: { format: input.format },
        ip: null,
        createdAt: now,
      });

      return { orgId, projectId, slug };
    });
  }

  /** Creates the Org, OWNER membership, agent catalog and trial subscription. Returns the orgId. */
  private async bootstrapTenant(
    repos: Repositories,
    input: CompleteOnboardingInput,
    now: Date,
  ): Promise<string> {
    const orgId = this.deps.ids.next();
    const orgName = input.projectName.trim();
    const slug = await this.uniqueOrgSlug(repos, Slug.fromName(orgName).value);

    await repos.orgs.create({ id: orgId, name: orgName, slug, createdAt: now, updatedAt: now });
    await repos.memberships.create({
      id: this.deps.ids.next(),
      orgId,
      userId: input.userId,
      role: 'OWNER',
      createdAt: now,
    });
    await repos.agents.createMany(
      AGENT_ROSTER.map((r) => ({
        id: this.deps.ids.next(),
        orgId,
        slot: r.slot,
        deityName: r.deityName,
        role: r.role,
        family: r.family,
        glyph: r.glyph,
        culture: r.culture,
        defaultTool: r.toolOptions[0]!,
        createdAt: now,
      })),
    );
    await repos.subscriptions.create({
      id: this.deps.ids.next(),
      orgId,
      plan: 'FREE',
      billingCycle: 'MONTHLY',
      seats: 1,
      status: 'TRIALING',
      runMinutesQuota: 500,
      runMinutesUsed: 0,
      providerCustomerId: null,
      providerSubscriptionId: null,
      currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    });
    await repos.audit.append({
      id: this.deps.ids.next(),
      orgId,
      actorUserId: input.userId,
      action: 'org.created',
      targetType: 'Org',
      targetId: orgId,
      metadata: {},
      ip: null,
      createdAt: now,
    });

    return orgId;
  }

  private async uniqueOrgSlug(repos: Repositories, base: string): Promise<string> {
    let candidate = base;
    let n = 1;
    while (await repos.orgs.findBySlug(candidate)) {
      n += 1;
      candidate = `${base}-${n}`.slice(0, 64);
    }
    return candidate;
  }

  private async uniqueProjectSlug(repos: Repositories, orgId: string, base: string): Promise<string> {
    let candidate = base;
    let n = 1;
    while (await repos.projects.existsBySlug(orgId, candidate)) {
      n += 1;
      candidate = `${base}-${n}`.slice(0, 64);
    }
    return candidate;
  }
}
