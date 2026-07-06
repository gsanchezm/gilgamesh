import { AGENT_ROSTER, personaPrompt, type AgentSlot } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { AgentBrainPort } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { KnowledgeRetrievalPort } from '../ports/knowledge';
import type {
  AgentRecord,
  ChatMessageRecord,
  ChatMessageRole,
  ChatSessionRecord,
  ProjectRecord,
  TestCasePriority,
} from '../ports/records';
import type {
  AgentRepository,
  AuditLogRepository,
  ChatMessageRepository,
  ChatSessionRepository,
  FeatureRepository,
  MembershipRepository,
  ProjectRepository,
  ToolBindingRepository,
} from '../ports/repositories';
import { requireProjectAccess } from './authz';
import type { RunView } from './runs';
import type { GeneratedDraftsView } from './testlab-generate';
import type { TestCaseView } from './testlab-testcases';

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const READERS = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
const MAX_MESSAGE_CHARS = 4000;
/** Below this router confidence the lead (Zeus) answers (spec §routing). */
const CONFIDENCE_THRESHOLD = 0.6;
const RETRIEVAL_TOP_K = 4;
const ROUTER_SYSTEM =
  'You are the Gilgamesh chat router. Given {"classify": <message>}, respond ONLY with ' +
  '{"slot": <AgentSlot key>, "confidence": <0..1>} — the specialist best suited to answer.';

export interface ChatSessionView {
  id: string;
  projectId: string;
  agentId: string | null;
  createdAt: Date;
}

export interface ChatMessageView {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  agentId: string | null;
  content: string;
  runId: string | null;
  createdAt: Date;
}

/**
 * The closed tool whitelist (spec §tool-calling): chat may invoke EXISTING use cases only, with the
 * caller's own identity — RBAC, quota and audit of the underlying path all apply unchanged.
 */
export interface ChatTools {
  triggerRun: {
    execute(i: {
      userId: string;
      projectId: string;
      targetKind: 'FEATURE' | 'TESTCASE';
      targetId: string;
      runLabel?: string;
    }): Promise<RunView>;
  };
  createTestCase: {
    execute(i: { userId: string; projectId: string; title: string; priority: TestCasePriority }): Promise<TestCaseView>;
  };
  generateDrafts: {
    execute(i: { userId: string; projectId: string; prompt: string }): Promise<GeneratedDraftsView>;
  };
}

function toView(m: ChatMessageRecord): ChatMessageView {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    agentId: m.agentId,
    content: m.content,
    runId: m.runId,
    createdAt: m.createdAt,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** A brain answer that is a `{"tool": …}` JSON object is a tool call; anything else is prose. */
function parseToolCall(text: string): { tool: string; args: Record<string, unknown> } | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (isRecord(v) && typeof v.tool === 'string') return { tool: v.tool, args: v };
  } catch {
    /* prose */
  }
  return null;
}

interface CreateSessionDeps {
  chatSessions: ChatSessionRepository;
  agents: AgentRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

export class CreateChatSession {
  constructor(private readonly deps: CreateSessionDeps) {}

  async execute(input: { userId: string; projectId: string; agentId?: string | null }): Promise<ChatSessionView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);

    let pinned: AgentRecord | null = null;
    if (input.agentId) {
      const agents = await this.deps.agents.listForOrg(project.orgId);
      pinned = agents.find((a) => a.id === input.agentId) ?? null;
      if (!pinned) throw new ApplicationError('VALIDATION', 'The pinned agent is not in this organization.');
    }

    const now = this.deps.clock.now();
    const rec: ChatSessionRecord = {
      id: this.deps.ids.next(),
      orgId: project.orgId,
      projectId: project.id,
      agentId: pinned?.id ?? null,
      createdById: input.userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.chatSessions.create(rec);

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'chat.session.created',
      targetType: 'ChatSession',
      targetId: rec.id,
      metadata: { pinnedSlot: pinned?.slot ?? null },
      ip: null,
      createdAt: now,
    });

    return { id: rec.id, projectId: rec.projectId, agentId: rec.agentId, createdAt: rec.createdAt };
  }
}

interface RoutingDecision {
  agent: AgentRecord;
  /** false when the session pin fixed the agent (no classify call was made). */
  routed: boolean;
  /** true when the lead answered instead of a routed/pinned specialist. */
  fallback: boolean;
}

interface SendDeps {
  chatSessions: ChatSessionRepository;
  chatMessages: ChatMessageRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  agents: AgentRepository;
  toolBindings: ToolBindingRepository;
  features: FeatureRepository;
  brain: AgentBrainPort;
  retrieval: KnowledgeRetrievalPort;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
  tools: ChatTools;
}

interface ToolOutcome {
  answerText: string;
  runId?: string;
  systemNarration?: { content: string; runId: string };
}

export class SendChatMessage {
  constructor(private readonly deps: SendDeps) {}

  async execute(input: {
    userId: string;
    sessionId: string;
    content: string;
  }): Promise<{ message: ChatMessageView; answer: ChatMessageView }> {
    const content = input.content.trim();
    if (!content) throw new ApplicationError('VALIDATION', 'A message is required.');
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new ApplicationError('VALIDATION', `A message may not exceed ${MAX_MESSAGE_CHARS} characters.`);
    }

    const session = await this.deps.chatSessions.findById(input.sessionId);
    if (!session) throw new ApplicationError('NOT_FOUND', 'Chat session not found.');
    const { project } = await requireProjectAccess(this.deps, input.userId, session.projectId, [...AUTHORS]);

    // The USER message persists before any brain work (spec §10.3) — a brain/tool failure never
    // loses what the member said.
    const userMsg: ChatMessageRecord = {
      id: this.deps.ids.next(),
      orgId: project.orgId,
      sessionId: session.id,
      role: 'USER',
      agentId: null,
      content,
      runId: null,
      createdAt: this.deps.clock.now(),
    };
    await this.deps.chatMessages.create(userMsg);

    const routing = await this.route(session, project, content);
    const entry = AGENT_ROSTER.find((e) => e.slot === routing.agent.slot)!;

    // Scoped grounding (spec §retrieval): org-visible chunks whose scope is the answering agent's
    // slot, 'shared', or NULL.
    const retrieved = await this.deps.retrieval.retrieveScoped(content, RETRIEVAL_TOP_K, {
      orgId: project.orgId,
      slot: routing.agent.slot,
    });
    const grounding = retrieved.map((r) => `[${r.citation.source}] ${r.content}`).join('\n\n');
    const system = grounding
      ? `${personaPrompt(entry)}\n\nReference context:\n${grounding}`
      : personaPrompt(entry);

    let full = '';
    for await (const { delta } of this.deps.brain.stream({
      tier: 'SONNET',
      system,
      messages: [{ role: 'user', content }],
    })) {
      full += delta;
    }

    const tool = parseToolCall(full);
    let outcome: ToolOutcome;
    if (tool) {
      outcome = await this.invokeTool(tool, input.userId, project, session.id);
      if (outcome.runId) await this.deps.chatMessages.setRunId(userMsg.id, outcome.runId);
    } else {
      const sources = [...new Set(retrieved.map((r) => r.citation.source))];
      outcome = { answerText: sources.length ? `${full}\n\nSources: ${sources.join(', ')}` : full };
    }

    const answer: ChatMessageRecord = {
      id: this.deps.ids.next(),
      orgId: project.orgId,
      sessionId: session.id,
      role: 'AGENT',
      agentId: routing.agent.id,
      content: outcome.answerText,
      runId: null,
      createdAt: this.deps.clock.now(),
    };
    await this.deps.chatMessages.create(answer);

    if (outcome.systemNarration) {
      await this.deps.chatMessages.create({
        id: this.deps.ids.next(),
        orgId: project.orgId,
        sessionId: session.id,
        role: 'SYSTEM',
        agentId: null,
        content: outcome.systemNarration.content,
        runId: outcome.systemNarration.runId,
        createdAt: this.deps.clock.now(),
      });
    }

    const now = this.deps.clock.now();
    await this.deps.chatSessions.touch(session.id, now);
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'chat.message.sent',
      targetType: 'ChatSession',
      targetId: session.id,
      // Observability without content: length + routing decision only (never the message text).
      metadata: {
        length: content.length,
        slot: routing.agent.slot,
        routed: routing.routed,
        tier: routing.routed ? 'HAIKU' : null,
        fallback: routing.fallback,
      },
      ip: null,
      createdAt: now,
    });

    return { message: toView(userMsg), answer: toView(answer) };
  }

  /**
   * Spec §routing: a pinned session skips classification entirely; otherwise one HAIKU classify
   * picks the slot — low confidence (< 0.6) or a disabled (`ToolBinding.enabled = false`) target
   * falls back to the lead. The lead covers as last resort even if its own binding is disabled.
   */
  private async route(session: ChatSessionRecord, project: ProjectRecord, content: string): Promise<RoutingDecision> {
    const agents = await this.deps.agents.listForOrg(project.orgId);
    const lead = agents.find((a) => a.slot === 'lead');
    if (!lead) throw new ApplicationError('NOT_FOUND', 'The agent catalog is not seeded for this organization.');

    if (session.agentId) {
      const pinned = agents.find((a) => a.id === session.agentId);
      return { agent: pinned ?? lead, routed: false, fallback: !pinned };
    }

    const res = await this.deps.brain.complete({
      tier: 'HAIKU',
      system: ROUTER_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ classify: content }) }],
    });
    let slot: string | null = null;
    let confidence = 0;
    try {
      const parsed = JSON.parse(res.text) as unknown;
      if (isRecord(parsed)) {
        if (typeof parsed.slot === 'string') slot = parsed.slot;
        if (typeof parsed.confidence === 'number') confidence = parsed.confidence;
      }
    } catch {
      /* malformed classification -> lead */
    }

    const candidate = slot ? agents.find((a) => a.slot === (slot as AgentSlot)) : undefined;
    if (!candidate || candidate.slot === 'lead' || confidence < CONFIDENCE_THRESHOLD) {
      return { agent: lead, routed: true, fallback: true };
    }
    const binding = await this.deps.toolBindings.findByProjectAndAgent(project.id, candidate.id);
    if (binding && !binding.enabled) return { agent: lead, routed: true, fallback: true };
    return { agent: candidate, routed: true, fallback: false };
  }

  private async invokeTool(
    call: { tool: string; args: Record<string, unknown> },
    userId: string,
    project: ProjectRecord,
    sessionId: string,
  ): Promise<ToolOutcome> {
    if (call.tool === 'enqueue_run') {
      const wanted = String(call.args.featureName ?? '').trim();
      const features = await this.deps.features.listForProject(project.id);
      const feature = features.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
      if (!feature) {
        return { answerText: `I could not find a feature named "${wanted}" in this project.` };
      }
      try {
        const run = await this.deps.tools.triggerRun.execute({
          userId,
          projectId: project.id,
          targetKind: 'FEATURE',
          targetId: feature.id,
          runLabel: 'chat',
        });
        await this.auditTool(project.orgId, userId, sessionId, call.tool, run.id);
        const lines = run.results.map((r) => `${r.status} — ${r.name}`).join('\n');
        const counts = `${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped (${run.ratePct}%)`;
        return {
          answerText: `Enqueued a run of "${feature.name}" — ${run.status}: ${counts}.`,
          runId: run.id,
          systemNarration: { runId: run.id, content: `Run ${run.status} — "${feature.name}": ${counts}.\n${lines}` },
        };
      } catch (e) {
        // The standard path's own gates (quota, RBAC, target checks) surface as a narrated outcome,
        // not a chat failure — the USER message is already persisted.
        if (e instanceof ApplicationError && ['QUOTA_EXCEEDED', 'FORBIDDEN', 'NOT_FOUND'].includes(e.code)) {
          return { answerText: `Run blocked (${e.code}): ${e.message}` };
        }
        throw e;
      }
    }

    if (call.tool === 'create_test_case') {
      const title = String(call.args.title ?? '').trim();
      const tc = await this.deps.tools.createTestCase.execute({
        userId,
        projectId: project.id,
        title: title || 'Untitled from chat',
        priority: 'MEDIUM',
      });
      await this.auditTool(project.orgId, userId, sessionId, call.tool, tc.id);
      return { answerText: `Created test case ${tc.key}: ${tc.title}. Review it in the Test Lab.` };
    }

    if (call.tool === 'generate_feature') {
      const prompt = String(call.args.prompt ?? '').trim();
      const drafts = await this.deps.tools.generateDrafts.execute({ userId, projectId: project.id, prompt });
      await this.auditTool(project.orgId, userId, sessionId, call.tool, null);
      const names = drafts.features.map((f) => f.name).join(', ');
      return {
        answerText:
          `Drafted ${drafts.features.length} feature(s) for review: ${names}. ` +
          'Nothing was persisted — keep what is useful from the Test Lab.',
      };
    }

    return {
      answerText: `Tool "${call.tool}" is not available. The chat can only invoke: create_test_case, generate_feature, enqueue_run.`,
    };
  }

  private async auditTool(
    orgId: string,
    userId: string,
    sessionId: string,
    tool: string,
    targetId: string | null,
  ): Promise<void> {
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId,
      actorUserId: userId,
      action: 'chat.tool.invoked',
      targetType: 'ChatSession',
      targetId: sessionId,
      metadata: { tool, targetId },
      ip: null,
      createdAt: this.deps.clock.now(),
    });
  }
}

interface EventsDeps {
  chatSessions: ChatSessionRepository;
  chatMessages: ChatMessageRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
}

/**
 * C3 (`GET /chat/{sessionId}/events`) source: the session's persisted messages in conversation
 * order. With the synchronous stub núcleo the SSE adapter REPLAYS these and closes; live push
 * arrives with the real Brain/Orchestration delivery (spec §13).
 */
export class GetChatEvents {
  constructor(private readonly deps: EventsDeps) {}

  async execute(input: { userId: string; sessionId: string }): Promise<ChatMessageView[]> {
    const session = await this.deps.chatSessions.findById(input.sessionId);
    if (!session) throw new ApplicationError('NOT_FOUND', 'Chat session not found.');
    await requireProjectAccess(this.deps, input.userId, session.projectId, [...READERS]);
    return (await this.deps.chatMessages.listForSession(session.id)).map(toView);
  }
}
