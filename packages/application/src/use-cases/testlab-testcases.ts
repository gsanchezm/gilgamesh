import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { TestCasePriority, TestCaseRecord, TestCaseStatus } from '../ports/records';
import type {
  AgentRepository,
  AuditLogRepository,
  MembershipRepository,
  ProjectRepository,
  SliceRepository,
  TestCaseRepository,
} from '../ports/repositories';
import { requireProjectAccess } from './authz';

export interface TestCaseView {
  id: string;
  key: string;
  title: string;
  steps: string;
  data: string;
  expected: string;
  priority: TestCasePriority;
  status: TestCaseStatus;
  sliceId: string | null;
  assignedAgentId: string | null;
}

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const PRIORITIES: TestCasePriority[] = ['HIGH', 'MEDIUM', 'LOW'];
/** Bounded retries for the derive-key/insert race on the unique (projectId, key) constraint (audit #7). */
const MAX_KEY_RETRIES = 8;

interface TestCaseDeps {
  testCases: TestCaseRepository;
  slices: SliceRepository;
  agents: AgentRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

function toView(t: TestCaseRecord): TestCaseView {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    steps: t.steps,
    data: t.data,
    expected: t.expected,
    priority: t.priority,
    status: t.status,
    sliceId: t.sliceId,
    assignedAgentId: t.assignedAgentId,
  };
}

function nextKey(existing: TestCaseRecord[], prefix: string): string {
  const max = existing.reduce((m, tc) => {
    const match = /(\d+)$/.exec(tc.key);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  return `TC_${prefix}_${String(max + 1).padStart(3, '0')}`;
}

async function resolveSlicePrefix(
  deps: Pick<TestCaseDeps, 'slices'>,
  projectId: string,
  sliceId: string | null | undefined,
): Promise<string> {
  if (!sliceId) return 'PRJ';
  const slice = await deps.slices.findById(sliceId);
  if (!slice || slice.projectId !== projectId) {
    throw new ApplicationError('VALIDATION', 'The slice does not belong to this project.');
  }
  return slice.key.toUpperCase();
}

async function requireAgentInOrg(
  deps: Pick<TestCaseDeps, 'agents'>,
  orgId: string,
  agentId: string,
): Promise<void> {
  const agents = await deps.agents.listForOrg(orgId);
  if (!agents.some((a) => a.id === agentId)) {
    throw new ApplicationError('VALIDATION', 'The assigned agent is not in this organization.');
  }
}

async function audit(
  deps: Pick<TestCaseDeps, 'audit' | 'ids' | 'clock'>,
  orgId: string,
  userId: string,
  action: string,
  testCaseId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await deps.audit.append({
    id: deps.ids.next(),
    orgId,
    actorUserId: userId,
    action,
    targetType: 'TestCase',
    targetId: testCaseId,
    metadata,
    ip: null,
    createdAt: deps.clock.now(),
  });
}

export class CreateTestCase {
  constructor(private readonly deps: TestCaseDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    title: string;
    steps?: string;
    data?: string;
    expected?: string;
    priority: TestCasePriority;
    sliceId?: string | null;
    assignedAgentId?: string | null;
  }): Promise<TestCaseView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const title = input.title.trim();
    if (!title) throw new ApplicationError('VALIDATION', 'Title is required.');
    if (!PRIORITIES.includes(input.priority)) {
      throw new ApplicationError('VALIDATION', `Invalid priority "${input.priority}".`);
    }
    const prefix = await resolveSlicePrefix(this.deps, project.id, input.sliceId);
    if (input.assignedAgentId) await requireAgentInOrg(this.deps, project.orgId, input.assignedAgentId);

    // The key (TC_<prefix>_NNN) is derived from a read of the current max, so two concurrent authors
    // can compute the same key and collide on the unique (projectId, key) constraint. Re-read and retry
    // with the next free key on CONFLICT rather than surfacing a 500 (audit #7).
    for (let attempt = 0; ; attempt++) {
      const existing = await this.deps.testCases.listForProject(project.id);
      const now = this.deps.clock.now();
      const rec: TestCaseRecord = {
        id: this.deps.ids.next(),
        orgId: project.orgId,
        projectId: project.id,
        sliceId: input.sliceId || null,
        key: nextKey(existing, prefix),
        title,
        steps: input.steps ?? '',
        data: input.data ?? '',
        expected: input.expected ?? '',
        priority: input.priority,
        status: 'NOTRUN',
        assignedAgentId: input.assignedAgentId || null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.deps.testCases.create(rec);
      } catch (e) {
        if (e instanceof ApplicationError && e.code === 'CONFLICT' && attempt < MAX_KEY_RETRIES) continue;
        throw e;
      }
      await audit(this.deps, project.orgId, input.userId, 'testcase.created', rec.id, { key: rec.key });
      return toView(rec);
    }
  }
}

export class ListTestCases {
  constructor(
    private readonly deps: {
      testCases: TestCaseRepository;
      projects: ProjectRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: { userId: string; projectId: string; sliceId?: string }): Promise<TestCaseView[]> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId);
    return (await this.deps.testCases.listForProject(project.id, input.sliceId)).map(toView);
  }
}

export class GetTestCase {
  constructor(
    private readonly deps: {
      testCases: TestCaseRepository;
      projects: ProjectRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: { userId: string; testCaseId: string }): Promise<TestCaseView> {
    const tc = await this.deps.testCases.findById(input.testCaseId);
    if (!tc) throw new ApplicationError('NOT_FOUND', 'Test case not found.');
    await requireProjectAccess(this.deps, input.userId, tc.projectId);
    return toView(tc);
  }
}

export class UpdateTestCase {
  constructor(private readonly deps: TestCaseDeps) {}

  async execute(input: {
    userId: string;
    testCaseId: string;
    title?: string;
    steps?: string;
    data?: string;
    expected?: string;
    priority?: TestCasePriority;
    sliceId?: string | null;
    assignedAgentId?: string | null;
  }): Promise<TestCaseView> {
    const tc = await this.deps.testCases.findById(input.testCaseId);
    if (!tc) throw new ApplicationError('NOT_FOUND', 'Test case not found.');
    await requireProjectAccess(this.deps, input.userId, tc.projectId, [...AUTHORS]);

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new ApplicationError('VALIDATION', 'Title cannot be empty.');
      tc.title = title;
    }
    if (input.priority !== undefined) {
      if (!PRIORITIES.includes(input.priority)) {
        throw new ApplicationError('VALIDATION', `Invalid priority "${input.priority}".`);
      }
      tc.priority = input.priority;
    }
    if (input.sliceId !== undefined) {
      if (input.sliceId) await resolveSlicePrefix(this.deps, tc.projectId, input.sliceId);
      tc.sliceId = input.sliceId || null;
    }
    if (input.assignedAgentId !== undefined) {
      if (input.assignedAgentId) await requireAgentInOrg(this.deps, tc.orgId, input.assignedAgentId);
      tc.assignedAgentId = input.assignedAgentId || null;
    }
    if (input.steps !== undefined) tc.steps = input.steps;
    if (input.data !== undefined) tc.data = input.data;
    if (input.expected !== undefined) tc.expected = input.expected;
    tc.updatedAt = this.deps.clock.now();

    await this.deps.testCases.save(tc);
    await audit(this.deps, tc.orgId, input.userId, 'testcase.updated', tc.id, {});
    return toView(tc);
  }
}

export class DeleteTestCase {
  constructor(private readonly deps: TestCaseDeps) {}

  async execute(input: { userId: string; testCaseId: string }): Promise<void> {
    const tc = await this.deps.testCases.findById(input.testCaseId);
    if (!tc) throw new ApplicationError('NOT_FOUND', 'Test case not found.');
    await requireProjectAccess(this.deps, input.userId, tc.projectId, [...AUTHORS]);
    await this.deps.testCases.delete(tc.id);
    await audit(this.deps, tc.orgId, input.userId, 'testcase.deleted', tc.id, {});
  }
}
