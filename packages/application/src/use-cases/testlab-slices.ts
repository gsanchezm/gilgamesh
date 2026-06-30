import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { SliceRecord } from '../ports/records';
import type {
  AuditLogRepository,
  MembershipRepository,
  ProjectRepository,
  SliceRepository,
} from '../ports/repositories';
import { requireProjectAccess } from './authz';

export interface SliceView {
  id: string;
  key: string;
  name: string;
  order: number;
}

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;

function toView(s: SliceRecord): SliceView {
  return { id: s.id, key: s.key, name: s.name, order: s.order };
}

interface SliceDeps {
  slices: SliceRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

async function audit(
  deps: Pick<SliceDeps, 'audit' | 'ids' | 'clock'>,
  orgId: string,
  userId: string,
  action: string,
  sliceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await deps.audit.append({
    id: deps.ids.next(),
    orgId,
    actorUserId: userId,
    action,
    targetType: 'Slice',
    targetId: sliceId,
    metadata,
    ip: null,
    createdAt: deps.clock.now(),
  });
}

export class ListSlices {
  constructor(
    private readonly deps: {
      slices: SliceRepository;
      projects: ProjectRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: { userId: string; projectId: string }): Promise<SliceView[]> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId);
    return (await this.deps.slices.listForProject(project.id)).map(toView);
  }
}

export class CreateSlice {
  constructor(private readonly deps: SliceDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    key: string;
    name: string;
  }): Promise<SliceView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const key = input.key.trim();
    const name = input.name.trim();
    if (!key || !name) throw new ApplicationError('VALIDATION', 'Slice key and name are required.');

    const existing = await this.deps.slices.listForProject(project.id);
    if (existing.some((s) => s.key === key)) {
      throw new ApplicationError('CONFLICT', `A slice with key "${key}" already exists in this project.`);
    }
    const order = existing.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const rec: SliceRecord = { id: this.deps.ids.next(), orgId: project.orgId, projectId: project.id, key, name, order };
    await this.deps.slices.save(rec);
    await audit(this.deps, project.orgId, input.userId, 'slice.created', rec.id, { key, name });
    return toView(rec);
  }
}

export class UpdateSlice {
  constructor(private readonly deps: SliceDeps) {}

  async execute(input: {
    userId: string;
    sliceId: string;
    name?: string;
    order?: number;
  }): Promise<SliceView> {
    const slice = await this.deps.slices.findById(input.sliceId);
    if (!slice) throw new ApplicationError('NOT_FOUND', 'Slice not found.');
    await requireProjectAccess(this.deps, input.userId, slice.projectId, [...AUTHORS]);

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ApplicationError('VALIDATION', 'Slice name cannot be empty.');
      slice.name = name;
    }
    if (input.order !== undefined) slice.order = input.order;

    await this.deps.slices.save(slice);
    await audit(this.deps, slice.orgId, input.userId, 'slice.updated', slice.id, {});
    return toView(slice);
  }
}

export class DeleteSlice {
  constructor(private readonly deps: SliceDeps) {}

  async execute(input: { userId: string; sliceId: string }): Promise<void> {
    const slice = await this.deps.slices.findById(input.sliceId);
    if (!slice) throw new ApplicationError('NOT_FOUND', 'Slice not found.');
    await requireProjectAccess(this.deps, input.userId, slice.projectId, [...AUTHORS]);
    await this.deps.slices.delete(slice.id);
    await audit(this.deps, slice.orgId, input.userId, 'slice.deleted', slice.id, {});
  }
}
