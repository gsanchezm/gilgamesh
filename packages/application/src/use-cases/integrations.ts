import {
  AI_PROVIDER_CATALOG,
  DomainError,
  parseFeature,
  repoProviderForKey,
  SOURCE_REPO_CATALOG,
  type SourceRepoKey,
  isSourceRepoKey,
} from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { BrainKeyVerifier, RepoProvider, SecretVault } from '../ports/integrations';
import type { FeatureRecord, IntegrationGroup, IntegrationRecord, Role, ScenarioRecord } from '../ports/records';
import type {
  AuditLogRepository,
  FeatureRepository,
  IntegrationRepository,
  MembershipRepository,
  ProjectRepository,
  ScenarioRepository,
} from '../ports/repositories';
import type { UnitOfWork } from '../ports/unit-of-work';
import { requireProjectAccess } from './authz';

const ADMINS: Role[] = ['OWNER', 'ADMIN'];
const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const SOURCE_REPOS: IntegrationGroup = 'SOURCE_REPOS';

/** The full connectable catalog: source repos (S6) + AI providers (S9), each with its keystone group. */
const CATALOG: { key: string; name: string; group: IntegrationGroup }[] = [
  ...SOURCE_REPO_CATALOG.map((e) => ({ key: e.key as string, name: e.name, group: SOURCE_REPOS })),
  ...AI_PROVIDER_CATALOG.map((e) => ({ key: e.key as string, name: e.name, group: 'AI_PROVIDERS' as IntegrationGroup })),
];

/** Source-attributable view — NEVER carries `secretRef` or the raw token (S6-B). */
export interface IntegrationView {
  key: string;
  name: string;
  group: IntegrationGroup;
  connected: boolean;
  config: Record<string, unknown>;
  connectedAt: Date | null;
}

interface IntegrationDeps {
  integrations: IntegrationRepository;
  memberships: MembershipRepository;
  repoProvider: RepoProvider;
  brainKeys: BrainKeyVerifier;
  vault: SecretVault;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

async function requireMember(deps: { memberships: MembershipRepository }, userId: string, orgId: string): Promise<Role> {
  const role = await deps.memberships.findRole(orgId, userId);
  if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
  return role;
}

async function requireOrgAdmin(deps: { memberships: MembershipRepository }, userId: string, orgId: string): Promise<void> {
  const role = await requireMember(deps, userId, orgId);
  if (!ADMINS.includes(role)) throw new ApplicationError('FORBIDDEN', 'Owners and admins only.');
}

function viewOf(
  key: string,
  name: string,
  group: IntegrationGroup,
  rec: IntegrationRecord | undefined,
): IntegrationView {
  return {
    key,
    name,
    group,
    connected: rec?.connected ?? false,
    config: rec?.config ?? {},
    connectedAt: rec?.connectedAt ?? null,
  };
}

function audit(deps: IntegrationDeps, orgId: string, userId: string, action: string, key: string): Promise<void> {
  return deps.audit.append({
    id: deps.ids.next(),
    orgId,
    actorUserId: userId,
    action,
    targetType: 'Integration',
    targetId: key,
    metadata: { key }, // never the token / secretRef
    ip: null,
    createdAt: deps.clock.now(),
  });
}

/** The SOURCE_REPOS catalog merged with this org's connected rows (member view). */
export class ListIntegrations {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(input: { userId: string; orgId: string }): Promise<IntegrationView[]> {
    await requireMember(this.deps, input.userId, input.orgId);
    const rows = await this.deps.integrations.listForOrg(input.orgId);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return CATALOG.map((entry) => viewOf(entry.key, entry.name, entry.group, byKey.get(entry.key)));
  }
}

/** Verify a token, store ONLY a vault ref, and upsert a connected row (OWNER/ADMIN). */
export class ConnectIntegration {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(input: {
    userId: string;
    orgId: string;
    key: string;
    token: string;
    config?: Record<string, unknown>;
  }): Promise<IntegrationView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const entry = CATALOG.find((e) => e.key === input.key);
    if (!entry) throw new ApplicationError('VALIDATION', `Unknown integration: ${input.key}`);
    if (isSourceRepoKey(input.key)) {
      await this.deps.repoProvider.verify({ key: input.key, token: input.token }); // throws on empty/unknown
    } else {
      await this.deps.brainKeys.verify({ key: input.key, token: input.token }); // AI provider key (S9)
    }
    const secretRef = await this.deps.vault.put(`${input.orgId}/${input.key}`, input.token); // token discarded

    const existing = await this.deps.integrations.findByKey(input.orgId, input.key);
    const rec: IntegrationRecord = {
      id: existing?.id ?? this.deps.ids.next(),
      orgId: input.orgId,
      key: input.key,
      group: entry.group,
      connected: true,
      secretRef,
      config: input.config ?? existing?.config ?? {},
      connectedById: input.userId,
      connectedAt: this.deps.clock.now(),
    };
    await this.deps.integrations.upsert(rec);
    await audit(this.deps, input.orgId, input.userId, 'integration.connected', input.key);
    return viewOf(input.key, entry.name, entry.group, rec);
  }
}

/** Clear the connection + the vault ref (OWNER/ADMIN); idempotent for a never-connected key. */
export class DisconnectIntegration {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(input: { userId: string; orgId: string; key: string }): Promise<IntegrationView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    const entry = CATALOG.find((e) => e.key === input.key);
    if (!entry) throw new ApplicationError('VALIDATION', `Unknown integration: ${input.key}`);
    const existing = await this.deps.integrations.findByKey(input.orgId, input.key);
    if (!existing || !existing.connected) return viewOf(input.key, entry.name, entry.group, existing ?? undefined);

    const rec: IntegrationRecord = {
      ...existing,
      connected: false,
      secretRef: null,
      connectedById: null,
      connectedAt: null,
    };
    await this.deps.integrations.upsert(rec);
    await audit(this.deps, input.orgId, input.userId, 'integration.disconnected', input.key);
    return viewOf(input.key, entry.name, entry.group, rec);
  }
}

export interface ImportedFeatureView {
  id: string;
  name: string;
  path: string;
  scenarioCount: number;
}

interface ImportDeps {
  uow: UnitOfWork;
  integrations: IntegrationRepository;
  repoProvider: RepoProvider;
  features: FeatureRepository;
  scenarios: ScenarioRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

function parseOrReject(content: string): { name: string; scenarios: { name: string; order: number }[] } {
  try {
    return parseFeature(content);
  } catch (err) {
    if (err instanceof DomainError) throw new ApplicationError('VALIDATION', err.message);
    throw err;
  }
}

/**
 * Import `.feature` files from the org's connected SOURCE_REPOS integration into the project's Test Lab,
 * upserting Features by path (idempotent re-import) and linking the project to the repo. The integration is
 * resolved by `project.orgId` — never a client-supplied org (S6-C). Atomic.
 */
export class ImportRepoFeatures {
  constructor(private readonly deps: ImportDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    fullName: string;
    branch: string;
  }): Promise<{ imported: number; features: ImportedFeatureView[] }> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const fullName = input.fullName.trim();
    const branch = input.branch.trim() || 'main';
    if (!fullName) throw new ApplicationError('VALIDATION', 'A repository full name is required.');

    const rows = await this.deps.integrations.listForOrg(project.orgId);
    const connected = rows.find((r) => r.group === SOURCE_REPOS && r.connected && r.secretRef);
    if (!connected) throw new ApplicationError('VALIDATION', 'Connect a source repository before importing.');

    const files = (
      await this.deps.repoProvider.listFeatureFiles({ secretRef: connected.secretRef!, fullName, branch })
    ).filter((f) => f.path.endsWith('.feature'));

    const now = this.deps.clock.now();
    const summaries: ImportedFeatureView[] = [];

    await this.deps.uow.transaction(async (repos) => {
      for (const file of files) {
        const parsed = parseOrReject(file.content);
        // Atomic create-or-update by (projectId, path) — concurrency-safe idempotent re-import (the DB unique
        // constraint serializes concurrent inserts). The returned record's id is authoritative for scenarios.
        const persisted = await repos.features.upsertByPath({
          id: this.deps.ids.next(),
          orgId: project.orgId,
          projectId: project.id,
          sliceId: null,
          name: parsed.name,
          path: file.path,
          content: file.content,
          createdAt: now,
          updatedAt: now,
        });
        const scenarios: ScenarioRecord[] = parsed.scenarios.map((s) => ({
          id: this.deps.ids.next(),
          orgId: project.orgId,
          featureId: persisted.id,
          name: s.name,
          order: s.order,
          lastStatus: null,
        }));
        await repos.scenarios.replaceForFeature(persisted.id, scenarios);
        summaries.push({ id: persisted.id, name: persisted.name, path: persisted.path, scenarioCount: scenarios.length });
      }
      // Targeted repo-link update (never a full-row write from the stale pre-tx snapshot).
      await repos.projects.linkRepo(project.id, {
        repoProvider: repoProviderForKey(connected.key as SourceRepoKey),
        repoFullName: fullName,
        repoBranch: branch,
        repoLastSyncAt: now,
        updatedAt: now,
      });
    });

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'repo.imported',
      targetType: 'Project',
      targetId: project.id,
      metadata: { key: connected.key, fullName, branch, imported: summaries.length },
      ip: null,
      createdAt: now,
    });
    return { imported: summaries.length, features: summaries };
  }
}
