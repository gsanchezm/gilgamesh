import type { AgentSlot, AgentFamily } from '@gilgamesh/domain';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type UserStatus = 'ACTIVE' | 'DISABLED';
export type ProjectFormat = 'BDD' | 'TRADITIONAL';
export type Plan = 'TEAM' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

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
  createdAt: Date;
  updatedAt: Date;
}

export interface SliceRecord {
  id: string;
  orgId: string;
  projectId: string;
  key: string;
  name: string;
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
