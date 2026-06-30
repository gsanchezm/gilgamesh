import { DomainError, parseFeature } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { FeatureRecord, ScenarioRecord, TestCaseStatus } from '../ports/records';
import type {
  AuditLogRepository,
  FeatureRepository,
  MembershipRepository,
  ProjectRepository,
  ScenarioRepository,
  SliceRepository,
} from '../ports/repositories';
import { requireProjectAccess } from './authz';

export interface ScenarioView {
  name: string;
  order: number;
  lastStatus: TestCaseStatus | null;
}

export interface FeatureView {
  id: string;
  name: string;
  path: string;
  sliceId: string | null;
  content: string;
  scenarios: ScenarioView[];
}

export interface FeatureSummaryView {
  id: string;
  name: string;
  path: string;
  sliceId: string | null;
  scenarioCount: number;
}

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;

interface FeatureDeps {
  features: FeatureRepository;
  scenarios: ScenarioRepository;
  slices: SliceRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

function scenarioView(s: ScenarioRecord): ScenarioView {
  return { name: s.name, order: s.order, lastStatus: s.lastStatus };
}

function featureView(f: FeatureRecord, scenarios: ScenarioRecord[]): FeatureView {
  return {
    id: f.id,
    name: f.name,
    path: f.path,
    sliceId: f.sliceId,
    content: f.content,
    scenarios: scenarios.map(scenarioView),
  };
}

/** Parse content, mapping a gherkin DomainError to a VALIDATION application error (422). */
function parseOrReject(content: string): { name: string; scenarios: { name: string; order: number }[] } {
  try {
    return parseFeature(content);
  } catch (err) {
    if (err instanceof DomainError) throw new ApplicationError('VALIDATION', err.message);
    throw err;
  }
}

async function audit(
  deps: Pick<FeatureDeps, 'audit' | 'ids' | 'clock'>,
  orgId: string,
  userId: string,
  action: string,
  featureId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await deps.audit.append({
    id: deps.ids.next(),
    orgId,
    actorUserId: userId,
    action,
    targetType: 'Feature',
    targetId: featureId,
    metadata,
    ip: null,
    createdAt: deps.clock.now(),
  });
}

async function requireSliceInProject(
  deps: Pick<FeatureDeps, 'slices'>,
  projectId: string,
  sliceId: string,
): Promise<void> {
  const slice = await deps.slices.findById(sliceId);
  if (!slice || slice.projectId !== projectId) {
    throw new ApplicationError('VALIDATION', 'The slice does not belong to this project.');
  }
}

export class CreateFeature {
  constructor(private readonly deps: FeatureDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    path: string;
    content: string;
    sliceId?: string | null;
  }): Promise<FeatureView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    if (input.sliceId) await requireSliceInProject(this.deps, project.id, input.sliceId);

    const parsed = parseOrReject(input.content);
    const now = this.deps.clock.now();
    const feature: FeatureRecord = {
      id: this.deps.ids.next(),
      orgId: project.orgId,
      projectId: project.id,
      sliceId: input.sliceId ?? null,
      name: parsed.name,
      path: input.path,
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.features.create(feature);
    const scenarios = this.toScenarioRecords(feature, parsed.scenarios);
    await this.deps.scenarios.replaceForFeature(feature.id, scenarios);
    await audit(this.deps, project.orgId, input.userId, 'feature.created', feature.id, {
      scenarioCount: scenarios.length,
    });
    return featureView(feature, scenarios);
  }

  private toScenarioRecords(
    feature: FeatureRecord,
    parsed: { name: string; order: number }[],
  ): ScenarioRecord[] {
    return parsed.map((s) => ({
      id: this.deps.ids.next(),
      orgId: feature.orgId,
      featureId: feature.id,
      name: s.name,
      order: s.order,
      lastStatus: null,
    }));
  }
}

export class ListFeatures {
  constructor(
    private readonly deps: {
      features: FeatureRepository;
      scenarios: ScenarioRepository;
      projects: ProjectRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: {
    userId: string;
    projectId: string;
    sliceId?: string;
  }): Promise<FeatureSummaryView[]> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId);
    const features = await this.deps.features.listForProject(project.id, input.sliceId);
    const out: FeatureSummaryView[] = [];
    for (const f of features) {
      const scenarios = await this.deps.scenarios.listForFeature(f.id);
      out.push({ id: f.id, name: f.name, path: f.path, sliceId: f.sliceId, scenarioCount: scenarios.length });
    }
    return out;
  }
}

export class GetFeature {
  constructor(
    private readonly deps: {
      features: FeatureRepository;
      scenarios: ScenarioRepository;
      projects: ProjectRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: { userId: string; featureId: string }): Promise<FeatureView> {
    const feature = await this.deps.features.findById(input.featureId);
    if (!feature) throw new ApplicationError('NOT_FOUND', 'Feature not found.');
    await requireProjectAccess(this.deps, input.userId, feature.projectId);
    const scenarios = await this.deps.scenarios.listForFeature(feature.id);
    return featureView(feature, scenarios);
  }
}

export class UpdateFeature {
  constructor(private readonly deps: FeatureDeps) {}

  async execute(input: {
    userId: string;
    featureId: string;
    content?: string;
    path?: string;
    sliceId?: string | null;
  }): Promise<FeatureView> {
    const feature = await this.deps.features.findById(input.featureId);
    if (!feature) throw new ApplicationError('NOT_FOUND', 'Feature not found.');
    await requireProjectAccess(this.deps, input.userId, feature.projectId, [...AUTHORS]);

    let scenarios = await this.deps.scenarios.listForFeature(feature.id);
    if (input.content !== undefined && input.content !== feature.content) {
      const parsed = parseOrReject(input.content);
      feature.content = input.content;
      feature.name = parsed.name;
      scenarios = parsed.scenarios.map((s) => ({
        id: this.deps.ids.next(),
        orgId: feature.orgId,
        featureId: feature.id,
        name: s.name,
        order: s.order,
        lastStatus: null,
      }));
      await this.deps.scenarios.replaceForFeature(feature.id, scenarios);
    }
    if (input.path !== undefined) feature.path = input.path;
    if (input.sliceId !== undefined) {
      if (input.sliceId) await requireSliceInProject(this.deps, feature.projectId, input.sliceId);
      feature.sliceId = input.sliceId;
    }
    feature.updatedAt = this.deps.clock.now();
    await this.deps.features.save(feature);
    await audit(this.deps, feature.orgId, input.userId, 'feature.updated', feature.id, {
      scenarioCount: scenarios.length,
    });
    return featureView(feature, scenarios);
  }
}

export class DeleteFeature {
  constructor(private readonly deps: FeatureDeps) {}

  async execute(input: { userId: string; featureId: string }): Promise<void> {
    const feature = await this.deps.features.findById(input.featureId);
    if (!feature) throw new ApplicationError('NOT_FOUND', 'Feature not found.');
    await requireProjectAccess(this.deps, input.userId, feature.projectId, [...AUTHORS]);
    await this.deps.scenarios.deleteForFeature(feature.id);
    await this.deps.features.delete(feature.id);
    await audit(this.deps, feature.orgId, input.userId, 'feature.deleted', feature.id, {});
  }
}
