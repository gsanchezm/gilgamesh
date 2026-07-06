import { AGENT_ROSTER, personaPrompt, type AgentSlot } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import { hasBrainForOrg, hasStreamWithUsage, type AgentBrainPort } from '../ports/brain';
import type { BrainTokenMeter } from '../brain/token-billing';
import type { EventBus } from '../ports/events';
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
import { validateToolArgs } from './chat-tools';
import { formatGrounding } from './knowledge';
import type { RunView } from './runs';
import type { GeneratedDraftsView } from './testlab-generate';
import type { TestCaseView } from './testlab-testcases';

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const MAX_MESSAGE_CHARS = 4000;
/** Below this router confidence the lead (Zeus) answers (spec §routing). */
const CONFIDENCE_THRESHOLD = 0.6;
const RETRIEVAL_TOP_K = 4;
/** Caller-intent anchor for router requests — the stub brain dispatches on this prefix (review S8). */
export const CHAT_ROUTER_PREFIX = 'You are the Gilgamesh chat router';
const ROUTER_SYSTEM =
  `${CHAT_ROUTER_PREFIX}. Given {"classify": <message>}, respond ONLY with ` +
  '{"slot": <AgentSlot key>, "confidence": <0..1>} — the specialist best suited to answer.';
// Mirror the direct endpoints' DTO caps (apps/api INPUT_LIMITS): a chat tool call must not widen
// what POST /test-cases (title ≤ 256) and /test-cases/generate (prompt ≤ 2000) accept (review S8).
const TOOL_TITLE_MAX = 256;
const TOOL_PROMPT_MAX = 2000;

export interface ChatSessionView {
  id: string;
  projectId: string;
  agentId: string | null;
  createdAt: Date;
}

/**
 * One row of the `GET /projects/{id}/chat` list (slice 11). `title` is DERIVED — the session's
 * first USER message trimmed to {@link SESSION_TITLE_MAX_CHARS}, never stored (spec 11 §13);
 * null when the session has no USER message yet.
 */
export interface ChatSessionListItemView {
  id: string;
  agentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  title: string | null;
}

/** Derived session-title budget (spec 11 §8 AC-CRS-01): the first USER message, ≤ 60 chars. */
export const SESSION_TITLE_MAX_CHARS = 60;

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

/** The C3/SSE wire shape for a persisted message (the `ChatEvent` MESSAGE frame — spec 08 s13). */
function wireMessage(m: ChatMessageRecord) {
  return {
    type: 'MESSAGE',
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    agentId: m.agentId,
    content: m.content,
    runId: m.runId,
    at: m.createdAt.toISOString(),
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
  /** S14: the atomic BrainUsage-row + token-counter charge seam (replaces raw brainUsage.append). */
  billing: BrainTokenMeter;
  events: EventBus;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
  tools: ChatTools;
}

/**
 * The in-chat narration when the org's AI token allowance is exhausted (spec 14 AC-TOKB-05):
 * a chat send never 402s or 500s — the block is narrated, mirroring the brain-outage message.
 */
export const CHAT_TOKEN_QUOTA_NARRATION =
  'Your workspace has used its monthly AI token allowance — upgrade your plan to keep chatting with the pantheon.';

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

    // Org-BYOK call-time resolution (S9 follow-up): a forOrg-capable adapter resolves this org's
    // brain (org key → platform key → stub) once per send; plain adapters keep the direct path.
    const brain = hasBrainForOrg(this.deps.brain) ? this.deps.brain.forOrg(project.orgId) : this.deps.brain;

    // S14 token quota — ONE pre-check per send, BEFORE any billable brain call (router, grounding
    // embed, answer). When exhausted the send still succeeds: the block is narrated (AC-TOKB-05),
    // no brain call is made and nothing is charged. Mid-send crossings finish the send (spec 14
    // §5.2 — overshoot is bounded by one send); the NEXT send blocks.
    const quotaBlocked = await this.deps.billing.isExhausted(project.orgId);

    const routing = await this.route(brain, session, project, content, quotaBlocked);
    const entry = AGENT_ROSTER.find((e) => e.slot === routing.agent.slot)!;

    // Scoped grounding (spec §retrieval): org-visible chunks whose scope is the answering agent's
    // slot, 'shared', or NULL. Skipped when quota-blocked — the query embed is a billable call.
    const retrieved = quotaBlocked
      ? []
      : await this.deps.retrieval.retrieveScoped(content, RETRIEVAL_TOP_K, {
          orgId: project.orgId,
          slot: routing.agent.slot,
        });
    const grounding = formatGrounding(retrieved);
    const system = grounding
      ? `${personaPrompt(entry)}\n\nReference context:\n${grounding}`
      : personaPrompt(entry);

    const topic = `chat:${session.id}`;
    await this.deps.events.publish(topic, wireMessage(userMsg));

    let full = '';
    let brainDown = false;
    let chatUsage: { inputTokens: number; outputTokens: number } | null = null;
    if (!quotaBlocked) {
      try {
        const req = { tier: 'SONNET' as const, system, messages: [{ role: 'user', content }] };
        if (hasStreamWithUsage(brain)) {
          const withUsage = brain.streamWithUsage(req);
          for await (const { delta } of withUsage.events) {
            full += delta;
            await this.deps.events.publish(topic, { type: 'DELTA', delta });
          }
          chatUsage = await withUsage.usage;
        } else {
          for await (const { delta } of brain.stream(req)) {
            full += delta;
            await this.deps.events.publish(topic, { type: 'DELTA', delta });
          }
          // No usage side-channel on the frozen stream(): meter with a length estimate.
          chatUsage = { inputTokens: system.length + content.length, outputTokens: full.length };
        }
      } catch {
        // A brain outage narrates instead of failing the send — the USER message is already persisted
        // (spec 09 AC-BRAIN-03).
        brainDown = true;
      }
    }
    // S14: the actual usage charges atomically (BrainUsage row + brainTokensUsed, one transaction).
    if (chatUsage) await this.deps.billing.charge(project.orgId, 'CHAT', 'SONNET', chatUsage);

    let outcome: ToolOutcome;
    if (quotaBlocked) {
      outcome = { answerText: CHAT_TOKEN_QUOTA_NARRATION };
    } else if (brainDown) {
      outcome = { answerText: 'The pantheon brain is unavailable right now — please try again in a moment.' };
    } else {
      const tool = parseToolCall(full);
      if (tool) {
        outcome = await this.invokeTool(tool, input.userId, project, session.id);
        if (outcome.runId) await this.deps.chatMessages.setRunId(userMsg.id, outcome.runId);
      } else {
        const sources = [...new Set(retrieved.map((r) => r.citation.source))];
        outcome = { answerText: sources.length ? `${full}\n\nSources: ${sources.join(', ')}` : full };
      }
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
    await this.deps.events.publish(topic, wireMessage(answer));

    if (outcome.systemNarration) {
      const narration: ChatMessageRecord = {
        id: this.deps.ids.next(),
        orgId: project.orgId,
        sessionId: session.id,
        role: 'SYSTEM',
        agentId: null,
        content: outcome.systemNarration.content,
        runId: outcome.systemNarration.runId,
        createdAt: this.deps.clock.now(),
      };
      await this.deps.chatMessages.create(narration);
      await this.deps.events.publish(topic, wireMessage(narration));
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

    await this.deps.events.publish(topic, { type: 'DONE' });

    // Build the returned view from the known outcome — never from in-place record mutation, which
    // holds in-memory but not under Prisma's updateMany (review S8 parity fix).
    return { message: toView({ ...userMsg, runId: outcome.runId ?? userMsg.runId }), answer: toView(answer) };
  }

  /**
   * Spec §routing: a pinned session skips classification entirely; otherwise one HAIKU classify
   * picks the slot — low confidence (< 0.6) or a disabled (`ToolBinding.enabled = false`) target
   * falls back to the lead. The lead covers as last resort even if its own binding is disabled.
   * When the token quota is exhausted (S14) the classify call is skipped too — the pinned agent
   * (or the lead) fronts the narrated block without any billable call.
   */
  private async route(
    brain: AgentBrainPort,
    session: ChatSessionRecord,
    project: ProjectRecord,
    content: string,
    quotaBlocked = false,
  ): Promise<RoutingDecision> {
    const agents = await this.deps.agents.listForOrg(project.orgId);
    const lead = agents.find((a) => a.slot === 'lead');
    if (!lead) throw new ApplicationError('NOT_FOUND', 'The agent catalog is not seeded for this organization.');

    if (session.agentId) {
      const pinned = agents.find((a) => a.id === session.agentId);
      return { agent: pinned ?? lead, routed: false, fallback: !pinned };
    }
    if (quotaBlocked) return { agent: lead, routed: false, fallback: true };

    const res = await brain.complete({
      tier: 'HAIKU',
      system: ROUTER_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ classify: content }) }],
    });
    // S14: the router call charges atomically like every org-attributed surface.
    await this.deps.billing.charge(project.orgId, 'ROUTER', 'HAIKU', res.usage);
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
    // Registry-validated (S9, AC-TOOL-02/04): outside the whitelist -> refused with no audit row;
    // schema-invalid args -> narrated + audited, the underlying use case never runs.
    const validation = validateToolArgs(call.tool, call.args);
    if (validation === 'UNREGISTERED') {
      return {
        answerText: `Tool "${call.tool}" is not available. The chat can only invoke: create_test_case, generate_feature, enqueue_run.`,
      };
    }
    const audited = (targetId: string | null, outcome: string) =>
      this.auditTool(project.orgId, userId, sessionId, call.tool, targetId, outcome);
    if (validation) {
      await audited(null, 'INVALID_ARGS');
      return { answerText: `Tool "${call.tool}" blocked (INVALID_ARGS): ${validation}.` };
    }

    try {
      if (call.tool === 'enqueue_run') {
        const wanted = String(call.args.featureName ?? '').trim();
        const features = await this.deps.features.listForProject(project.id);
        const feature = features.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
        if (!feature) {
          await audited(null, 'TARGET_NOT_FOUND');
          return { answerText: `I could not find a feature named "${wanted}" in this project.` };
        }
        const run = await this.deps.tools.triggerRun.execute({
          userId,
          projectId: project.id,
          targetKind: 'FEATURE',
          targetId: feature.id,
          runLabel: 'chat',
        });
        await audited(run.id, 'OK');
        const lines = run.results.map((r) => `${r.status} — ${r.name}`).join('\n');
        const counts = `${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped (${run.ratePct}%)`;
        return {
          answerText: `Enqueued a run of "${feature.name}" — ${run.status}: ${counts}.`,
          runId: run.id,
          systemNarration: { runId: run.id, content: `Run ${run.status} — "${feature.name}": ${counts}.\n${lines}` },
        };
      }

      if (call.tool === 'create_test_case') {
        const title = String(call.args.title ?? '').trim().slice(0, TOOL_TITLE_MAX);
        const tc = await this.deps.tools.createTestCase.execute({
          userId,
          projectId: project.id,
          title,
          priority: 'MEDIUM',
        });
        await audited(tc.id, 'OK');
        return { answerText: `Created test case ${tc.key}: ${tc.title}. Review it in the Test Lab.` };
      }

      const prompt = String(call.args.prompt ?? '').trim().slice(0, TOOL_PROMPT_MAX);
      const drafts = await this.deps.tools.generateDrafts.execute({ userId, projectId: project.id, prompt });
      await audited(null, 'OK');
      const names = drafts.features.map((f) => f.name).join(', ');
      return {
        answerText:
          `Drafted ${drafts.features.length} feature(s) for review: ${names}. ` +
          'Nothing was persisted — keep what is useful from the Test Lab.',
      };
    } catch (e) {
      // The underlying path's own gates (quota, RBAC, conflicts, validation) surface as a narrated
      // outcome, not a chat failure — the USER message is already persisted. Every attempted
      // whitelisted call leaves an audit row, blocked or not (spec §9, review S8).
      if (e instanceof ApplicationError) {
        await audited(null, e.code);
        return { answerText: `Tool "${call.tool}" blocked (${e.code}): ${e.message}` };
      }
      throw e;
    }
  }

  private async auditTool(
    orgId: string,
    userId: string,
    sessionId: string,
    tool: string,
    targetId: string | null,
    outcome: string,
  ): Promise<void> {
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId,
      actorUserId: userId,
      action: 'chat.tool.invoked',
      targetType: 'ChatSession',
      targetId: sessionId,
      metadata: { tool, targetId, outcome },
      ip: null,
      createdAt: this.deps.clock.now(),
    });
  }
}

interface ListSessionsDeps {
  chatSessions: ChatSessionRepository;
  chatMessages: ChatMessageRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
}

/**
 * L1 (`GET /projects/{id}/chat`, keystone v0.4 — slice 11): the project's sessions newest-first
 * (updatedAt desc — the S8 send `touch` is what the ordering rides on) with a derived title from
 * each session's first USER message. One list query + ONE batched first-message lookup — never
 * a query per session (spec 11 §10.1). Chat is MEMBER+ end to end (S8 §10.2): VIEWERs may not
 * browse conversations either.
 */
export class ListChatSessions {
  constructor(private readonly deps: ListSessionsDeps) {}

  async execute(input: { userId: string; projectId: string }): Promise<ChatSessionListItemView[]> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const sessions = await this.deps.chatSessions.listForProject(project.id);
    if (sessions.length === 0) return [];

    const firsts = await this.deps.chatMessages.firstUserMessageBySession(sessions.map((s) => s.id));
    const titleBySession = new Map(
      firsts.map((m) => [m.sessionId, m.content.trim().slice(0, SESSION_TITLE_MAX_CHARS)]),
    );
    return sessions.map((s) => ({
      id: s.id,
      agentId: s.agentId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      title: titleBySession.get(s.id) ?? null,
    }));
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
    // Chat is MEMBER+ end to end (spec §10.2): a VIEWER may not read conversations either.
    await requireProjectAccess(this.deps, input.userId, session.projectId, [...AUTHORS]);
    return (await this.deps.chatMessages.listForSession(session.id)).map(toView);
  }
}
