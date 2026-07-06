import type { AgentSlot, AgentFamily, KnowledgeScope } from '@gilgamesh/domain';
import type { BrainSurface, BrainTier } from './brain';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type ChatMessageRole = 'USER' | 'AGENT' | 'SYSTEM';
export type UserStatus = 'ACTIVE' | 'DISABLED';
export type ProjectFormat = 'BDD' | 'TRADITIONAL';
export type TestCasePriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type TestCaseStatus = 'NOTRUN' | 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
export type Plan = 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
export type RunTrigger = 'MANUAL' | 'SCHEDULE' | 'CI';
export type RunTargetKind = 'FEATURE' | 'TESTCASE';
export type ResultStatus = 'PASS' | 'FAIL' | 'SKIP';

/**
 * Persistence-facing records — the contract between use cases and repository adapters.
 * They mirror the data model (keystone §2) but stay free of any ORM/framework types.
 */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  id: string;
  orgId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface ProjectRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  format: ProjectFormat;
  repoProvider: string | null;
  repoFullName: string | null;
  repoBranch: string | null;
  repoCommit: string | null;
  repoLastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationGroup =
  | 'SOURCE_REPOS'
  | 'PROJECT_TRACKING'
  | 'TEST_MANAGEMENT'
  | 'COMMUNICATION'
  | 'CICD'
  | 'DEVICES_BROWSERS';

/** A per-org integration connection (slice 6). `secretRef` is a vault reference — NEVER a raw token. */
export interface IntegrationRecord {
  id: string;
  orgId: string;
  key: string;
  group: IntegrationGroup;
  connected: boolean;
  secretRef: string | null;
  config: Record<string, unknown>;
  connectedById: string | null;
  connectedAt: Date | null;
}

export interface SliceRecord {
  id: string;
  orgId: string;
  projectId: string;
  key: string;
  name: string;
  order: number;
}

export interface FeatureRecord {
  id: string;
  orgId: string;
  projectId: string;
  sliceId: string | null;
  name: string;
  path: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScenarioRecord {
  id: string;
  orgId: string;
  featureId: string;
  name: string;
  order: number;
  lastStatus: TestCaseStatus | null;
}

export interface TestCaseRecord {
  id: string;
  orgId: string;
  projectId: string;
  sliceId: string | null;
  key: string;
  title: string;
  steps: string;
  data: string;
  expected: string;
  priority: TestCasePriority;
  status: TestCaseStatus;
  assignedAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A test execution (keystone `Run`, slice-3 field subset). A run targets exactly one authored entity
 * (a Feature → its scenarios, or a TestCase). Deferred keystone fields (mode, selectedStages, progress,
 * commitSha) belong to the Orchestration slice.
 */
export interface RunRecord {
  id: string;
  orgId: string;
  projectId: string;
  status: RunStatus;
  trigger: RunTrigger;
  targetKind: RunTargetKind;
  targetId: string;
  runLabel: string | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  total: number | null;
  ratePct: number | null;
  durationMs: number | null;
  createdById: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

/** A single per-scenario / per-test-case outcome of a Run (a `RunNode`-lite; the DAG is later). */
export interface RunResultRecord {
  id: string;
  orgId: string;
  runId: string;
  refId: string;
  name: string;
  status: ResultStatus;
  log: string[];
  order: number;
}

export interface AgentRecord {
  id: string;
  orgId: string;
  slot: AgentSlot;
  deityName: string;
  role: string;
  family: AgentFamily;
  glyph: string;
  culture: string;
  defaultTool: string;
  createdAt: Date;
}

export interface ToolBindingRecord {
  id: string;
  orgId: string;
  projectId: string;
  agentId: string;
  tool: string;
  enabled: boolean;
  updatedAt: Date;
}

export interface SubscriptionRecord {
  id: string;
  orgId: string;
  plan: Plan;
  billingCycle: BillingCycle;
  seats: number;
  status: SubscriptionStatus;
  runMinutesQuota: number;
  runMinutesUsed: number;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
}

/**
 * A knowledge-base chunk. The GLOBAL shared corpus (slice 5, owner decision S5-A) has `orgId`/`documentId`
 * null — retrieval is shared across all orgs. Per-org UPLOADED documents (slice 7) carry both, so they are
 * tenant-scoped: the shared `search`/`count` exclude them (orgId IS NULL) — no cross-org leak.
 */
export interface KnowledgeChunkRecord {
  id: string;
  /** Owning org for an uploaded chunk; null for the global shared corpus. */
  orgId?: string | null;
  /** The uploaded document this chunk belongs to; null for the global shared corpus. */
  documentId?: string | null;
  source: string;
  headingPath: string[];
  section: string;
  content: string;
  embedding: number[];
  tokenEstimate: number;
  /**
   * Keystone v0.2 per-agent visibility (slice 8): an AgentSlot key = visible only to that agent's
   * retrieval; `shared` or null/undefined = visible to every agent.
   */
  scope?: KnowledgeScope | null;
}

/** A per-org uploaded knowledge document (slice 7) — its text is chunked/embedded into `KnowledgeChunkRecord`s. */
export interface KnowledgeDocumentRecord {
  id: string;
  orgId: string;
  name: string;
  /** File kind: 'md' | 'txt' (real ingest) — PDF/docx parsing is a later, dependency-bearing follow-up. */
  type: string;
  chunkCount: number;
  createdAt: Date;
}

/** A chat conversation (keystone v0.2). `agentId` = the pinned agent when opened from a tile; null = routed. */
export interface ChatSessionRecord {
  id: string;
  orgId: string;
  projectId: string;
  agentId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One chat message (keystone v0.2). `runId` links a message that triggered a Run. */
export interface ChatMessageRecord {
  id: string;
  orgId: string;
  sessionId: string;
  role: ChatMessageRole;
  /** The answering/attributed agent for AGENT messages; null for USER/SYSTEM. */
  agentId: string | null;
  content: string;
  runId: string | null;
  createdAt: Date;
}

/** One metered brain call (keystone v0.3). Aggregated per org for the usage view; billing hooks in later. */
export interface BrainUsageRecord {
  id: string;
  orgId: string;
  tier: BrainTier;
  surface: BrainSurface;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  createdAt: Date;
}

export interface AuditLogRecord {
  id: string;
  /** Null for non-org-scoped events (e.g. auth.register / auth.login before a tenant exists). */
  orgId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: Date;
}
