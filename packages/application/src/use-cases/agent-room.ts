import {
  AGENT_ROSTER,
  FAMILY_COLORS,
  deriveAgentRuntimeStatus,
  type AgentFamily,
  type AgentRuntimeStatus,
  type AgentSlot,
} from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type {
  AgentRepository,
  AuditLogRepository,
  MembershipRepository,
  ProjectRepository,
  ToolBindingRepository,
} from '../ports/repositories';
import { requireProjectAccess } from './authz';

export interface AgentRoomAgentView {
  /** Agent.id — the tile-pinned chat entry deep-links `?agent=<id>` (slice 11, spec 11 §13). */
  id: string;
  slot: AgentSlot;
  deityName: string;
  role: string;
  family: AgentFamily;
  familyColor: string;
  glyph: string;
  culture: string;
  tool: string;
  toolOptions: string[];
  enabled: boolean;
  status: AgentRuntimeStatus;
}

export interface AgentRoomKpis {
  total: number;
  awake: number; // alias of `active`, kept for the web dashboard
  active: number;
  idle: number;
  busy: number;
  byFamily: Record<AgentFamily, number>;
  successRatePct: number | null;
  scenarios: number;
}

export interface AgentRoomView {
  project: { id: string; name: string; slug: string; format: string };
  agents: AgentRoomAgentView[];
  kpis: AgentRoomKpis;
}

function toolOptionsFor(slot: AgentSlot): string[] {
  return [...(AGENT_ROSTER.find((r) => r.slot === slot)?.toolOptions ?? [])];
}

function kpisFor(agents: AgentRoomAgentView[]): AgentRoomKpis {
  const byFamily: Record<AgentFamily, number> = { proceso: 0, ui: 0, backend: 0, guardian: 0 };
  let active = 0;
  let idle = 0;
  let busy = 0;
  for (const a of agents) {
    byFamily[a.family] += 1;
    if (a.status === 'ACTIVE') active += 1;
    else if (a.status === 'BUSY') busy += 1;
    else idle += 1;
  }
  return { total: agents.length, awake: active, active, idle, busy, byFamily, successRatePct: null, scenarios: 0 };
}

function viewOf(
  agent: { id: string; slot: AgentSlot; deityName: string; role: string; family: AgentFamily; glyph: string; culture: string; defaultTool: string },
  binding: { tool: string; enabled: boolean } | undefined,
): AgentRoomAgentView {
  const enabled = binding?.enabled ?? false;
  return {
    id: agent.id,
    slot: agent.slot,
    deityName: agent.deityName,
    role: agent.role,
    family: agent.family,
    familyColor: FAMILY_COLORS[agent.family],
    glyph: agent.glyph,
    culture: agent.culture,
    tool: binding?.tool ?? agent.defaultTool,
    toolOptions: toolOptionsFor(agent.slot),
    enabled,
    status: deriveAgentRuntimeStatus({ enabled, hasRunningNode: false }),
  };
}

const OPERATOR_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

export class GetAgentRoom {
  constructor(
    private readonly deps: {
      projects: ProjectRepository;
      agents: AgentRepository;
      toolBindings: ToolBindingRepository;
      memberships: MembershipRepository;
    },
  ) {}

  async execute(input: { userId: string; projectId: string }): Promise<AgentRoomView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId);
    const orgAgents = await this.deps.agents.listForOrg(project.orgId);
    const bindings = await this.deps.toolBindings.listForProject(project.id);
    const bindingByAgent = new Map(bindings.map((b) => [b.agentId, b]));

    const agents: AgentRoomAgentView[] = AGENT_ROSTER.flatMap((entry) => {
      const agent = orgAgents.find((a) => a.slot === entry.slot);
      return agent ? [viewOf(agent, bindingByAgent.get(agent.id))] : [];
    });

    return {
      project: { id: project.id, name: project.name, slug: project.slug, format: project.format },
      agents,
      kpis: kpisFor(agents),
    };
  }
}

export class SetAgentToolBinding {
  constructor(
    private readonly deps: {
      projects: ProjectRepository;
      agents: AgentRepository;
      toolBindings: ToolBindingRepository;
      memberships: MembershipRepository;
      audit: AuditLogRepository;
      ids: IdGenerator;
      clock: Clock;
    },
  ) {}

  async execute(input: {
    userId: string;
    projectId: string;
    slot: AgentSlot;
    tool?: string;
    enabled?: boolean;
  }): Promise<AgentRoomAgentView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [
      ...OPERATOR_ROLES,
    ]);

    const orgAgents = await this.deps.agents.listForOrg(project.orgId);
    const agent = orgAgents.find((a) => a.slot === input.slot);
    if (!agent) throw new ApplicationError('NOT_FOUND', 'Agent not found.');

    const binding = await this.deps.toolBindings.findByProjectAndAgent(project.id, agent.id);
    if (!binding) throw new ApplicationError('NOT_FOUND', 'Agent binding not found.');

    const toolChanged = input.tool !== undefined && input.tool !== binding.tool;
    const enabledChanged = input.enabled !== undefined && input.enabled !== binding.enabled;

    if (input.tool !== undefined) {
      if (!toolOptionsFor(input.slot).includes(input.tool)) {
        throw new ApplicationError('INVALID_TOOL', `Tool "${input.tool}" is not available for ${input.slot}.`);
      }
      binding.tool = input.tool;
    }
    if (input.enabled !== undefined) {
      binding.enabled = input.enabled;
    }
    binding.updatedAt = this.deps.clock.now();
    await this.deps.toolBindings.save(binding);

    if (toolChanged) {
      await this.audit(project.orgId, input.userId, binding.id, 'agent.tool.changed', {
        slot: input.slot,
        tool: binding.tool,
      });
    }
    if (enabledChanged) {
      await this.audit(project.orgId, input.userId, binding.id, 'agent.enabled.changed', {
        slot: input.slot,
        enabled: binding.enabled,
      });
    }

    return viewOf(agent, binding);
  }

  private async audit(
    orgId: string,
    userId: string,
    bindingId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId,
      actorUserId: userId,
      action,
      targetType: 'ToolBinding',
      targetId: bindingId,
      metadata,
      ip: null,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class WakeAllAgents {
  constructor(
    private readonly deps: {
      projects: ProjectRepository;
      toolBindings: ToolBindingRepository;
      memberships: MembershipRepository;
      audit: AuditLogRepository;
      ids: IdGenerator;
      clock: Clock;
    },
  ) {}

  async execute(input: { userId: string; projectId: string }): Promise<{ awake: number; total: number }> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [
      ...OPERATOR_ROLES,
    ]);
    const now = this.deps.clock.now();
    await this.deps.toolBindings.setEnabledForProject(project.id, true, now);
    const bindings = await this.deps.toolBindings.listForProject(project.id);

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'agent.wake_all',
      targetType: 'Project',
      targetId: project.id,
      metadata: {},
      ip: null,
      createdAt: now,
    });

    return { awake: bindings.filter((b) => b.enabled).length, total: bindings.length };
  }
}
