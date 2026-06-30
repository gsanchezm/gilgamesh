import { ApplicationError } from '../errors';
import type { AgentBrainPort } from '../ports/brain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { Citation, KnowledgeRetrievalPort } from '../ports/knowledge';
import type { ProjectFormat, TestCasePriority } from '../ports/records';
import type { AuditLogRepository, MembershipRepository, ProjectRepository } from '../ports/repositories';
import { requireProjectAccess } from './authz';

export interface FeatureDraft {
  name: string;
  path: string;
  content: string;
}

export interface TestCaseDraft {
  title: string;
  steps: string;
  data: string;
  expected: string;
  priority: TestCasePriority;
}

export interface GeneratedDraftsView {
  features: FeatureDraft[];
  testCases: TestCaseDraft[];
  citations: Citation[];
}

const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const PRIORITIES: TestCasePriority[] = ['HIGH', 'MEDIUM', 'LOW'];

const SYSTEM_PROMPT =
  'You are a QA authoring assistant. Given a JSON request {prompt, format, count}, respond with ONLY a ' +
  'JSON object {"features":[{"name","path","content"}],"testCases":[{"title","steps","data","expected",' +
  '"priority"}]}. For format=BDD return Gherkin feature drafts; for TRADITIONAL return test-case drafts. ' +
  'priority must be HIGH, MEDIUM or LOW. Do not include prose outside the JSON.';

interface GenerateDeps {
  brain: AgentBrainPort;
  retrieval: KnowledgeRetrievalPort;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Parse the brain's text into drafts, tolerating malformed output by dropping invalid entries. */
function parseDrafts(text: string): { features: FeatureDraft[]; testCases: TestCaseDraft[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { features: [], testCases: [] };
  }
  if (!isRecord(raw)) return { features: [], testCases: [] };

  const features: FeatureDraft[] = Array.isArray(raw.features)
    ? raw.features
        .filter(isRecord)
        .filter((f) => typeof f.content === 'string' && f.content.length > 0)
        .map((f) => ({ name: asString(f.name), path: asString(f.path), content: asString(f.content) }))
    : [];

  const testCases: TestCaseDraft[] = Array.isArray(raw.testCases)
    ? raw.testCases
        .filter(isRecord)
        .filter((t) => typeof t.title === 'string' && PRIORITIES.includes(t.priority as TestCasePriority))
        .map((t) => ({
          title: asString(t.title),
          steps: asString(t.steps),
          data: asString(t.data),
          expected: asString(t.expected),
          priority: t.priority as TestCasePriority,
        }))
    : [];

  return { features, testCases };
}

export class GenerateDrafts {
  constructor(private readonly deps: GenerateDeps) {}

  async execute(input: {
    userId: string;
    projectId: string;
    prompt: string;
    format?: ProjectFormat;
    count?: number;
  }): Promise<GeneratedDraftsView> {
    const { project } = await requireProjectAccess(this.deps, input.userId, input.projectId, [...AUTHORS]);
    const prompt = input.prompt.trim();
    if (!prompt) throw new ApplicationError('VALIDATION', 'A prompt is required.');
    const format = input.format ?? (project.format as ProjectFormat);
    const n = Math.trunc(Number(input.count ?? 3));
    const count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 10) : 3;

    // Slice 5: ground the generation in the shared knowledge base (RAG). The stub brain ignores the
    // grounding deterministically; a real brain uses it. Either way the citations flow to the output.
    const retrieved = await this.deps.retrieval.retrieve(prompt, 4);
    const grounding = retrieved.map((r) => `[${r.citation.source}] ${r.content}`).join('\n\n');

    const res = await this.deps.brain.complete({
      tier: 'SONNET',
      system: grounding
        ? `${SYSTEM_PROMPT}\n\nReference knowledge — ground your drafts in this and cite the source:\n${grounding}`
        : SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ prompt, format, count }) }],
    });
    const parsed = parseDrafts(res.text);
    // Enforce the count cap at the use-case boundary so the invariant holds regardless of which
    // AgentBrainPort adapter is plugged in (the real Claude one may not honor count).
    const drafts: GeneratedDraftsView = {
      features: parsed.features.slice(0, count),
      testCases: parsed.testCases.slice(0, count),
      citations: retrieved.map((r) => r.citation),
    };

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: project.orgId,
      actorUserId: input.userId,
      action: 'testlab.generated',
      targetType: 'Project',
      targetId: project.id,
      // Never store the raw prompt — only its length, the produced counts, and the grounding count.
      metadata: {
        promptLength: prompt.length,
        features: drafts.features.length,
        testCases: drafts.testCases.length,
        grounded: retrieved.length,
      },
      ip: null,
      createdAt: this.deps.clock.now(),
    });
    return drafts;
  }
}
