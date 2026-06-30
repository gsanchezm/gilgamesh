import {
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
import type { RepoProvider, SecretVault } from '../ports/integrations';
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

function viewOf(key: string, name: string, rec: IntegrationRecord | undefined): IntegrationView {
  return {
    key,
    name,
    group: SOURCE_REPOS,
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
    return SOURCE_REPO_CATALOG.map((entry) => viewOf(entry.key, entry.name, byKey.get(entry.key)));
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
    if (!isSourceRepoKey(input.key)) {
      throw new ApplicationError('VALIDATION', `Unknown source-repo integration: ${input.key}`);
    }
    await this.deps.repoProvider.verify({ key: input.key, token: input.token }); // throws on empty/unknown
    const secretRef = await this.deps.vault.put(`${input.orgId}/${input.key}`, input.token); // token discarded

    const existing = await this.deps.integrations.findByKey(input.orgId, input.key);
    const rec: IntegrationRecord = {
      id: existing?.id ?? this.deps.ids.next(),
      orgId: input.orgId,
      key: input.key,
      group: SOURCE_REPOS,
      connected: true,
      secretRef,
      config: input.config ?? existing?.config ?? {},
      connectedById: input.userId,
      connectedAt: this.deps.clock.now(),
    };
    await this.deps.integrations.upsert(rec);
    await audit(this.deps, input.orgId, input.userId, 'integration.connected', input.key);
    return viewOf(input.key, nameOf(input.key), rec);
  }
}

/** Clear the connection + the vault ref (OWNER/ADMIN); idempotent for a never-connected key. */
export class DisconnectIntegration {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(input: { userId: string; orgId: string; key: string }): Promise<IntegrationView> {
    await requireOrgAdmin(this.deps, input.userId, input.orgId);
    if (!isSourceRepoKey(input.key)) {
      throw new ApplicationError('VALIDATION', `Unknown source-repo integration: ${input.key}`);
    }
    const existing = await this.deps.integrations.findByKey(input.orgId, input.key);
    if (!existing || !existing.connected) return viewOf(input.key, nameOf(input.key), existing ?? undefined);

    const rec: IntegrationRecord = {
      ...existing,
      connected: false,
      secretRef: null,
      connectedById: null,
      connectedAt: null,
    };
    await this.deps.integrations.upsert(rec);
    await audit(this.deps, input.orgId, input.userId, 'integration.disconnected', input.key);
    return viewOf(input.key, nameOf(input.key), rec);
  }
}

function nameOf(key: string): string {
  return SOURCE_REPO_CATALOG.find((e) => e.key === key)?.name ?? key;
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
    const existing = await this.deps.features.listForProject(project.id);
    const byPath = new Map(existing.map((f) => [f.path, f]));
    const summaries: ImportedFeatureView[] = [];

    await this.deps.uow.transaction(async (repos) => {
      for (const file of files) {
        const parsed = parseOrReject(file.content);
        const prior = byPath.get(file.path);
        const feature: FeatureRecord = {
          id: prior?.id ?? this.deps.ids.next(),
          orgId: project.orgId,
          projectId: project.id,
          sliceId: prior?.sliceId ?? null,
          name: parsed.name,
          path: file.path,
          content: file.content,
          createdAt: prior?.createdAt ?? now,
          updatedAt: now,
        };
        if (prior) await repos.features.save(feature);
        else await repos.features.create(feature);
        const scenarios: ScenarioRecord[] = parsed.scenarios.map((s) => ({
          id: this.deps.ids.next(),
          orgId: project.orgId,
          featureId: feature.id,
          name: s.name,
          order: s.order,
          lastStatus: null,
        }));
        await repos.scenarios.replaceForFeature(feature.id, scenarios);
        summaries.push({ id: feature.id, name: feature.name, path: feature.path, scenarioCount: scenarios.length });
      }
      await repos.projects.save({
        ...project,
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
