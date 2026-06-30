import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { Role, UserStatus } from '../ports/records';
import type {
  AuditLogRepository,
  MembershipRepository,
  OrgRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';

/** UserView — the User entity without its passwordHash (keystone §6). */
export interface UserView {
  id: string;
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** OrgView — the Org entity as returned by the API. */
export interface OrgView {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

/** MeView — session context: the user, their memberships (org + role), and the active org. */
export interface MeView {
  user: UserView;
  memberships: Array<{ org: OrgView; role: Role }>;
  activeOrgId: string | null;
}

export class GetMe {
  constructor(
    private readonly deps: {
      users: UserRepository;
      memberships: MembershipRepository;
      orgs: OrgRepository;
    },
  ) {}

  async execute(input: { userId: string }): Promise<MeView> {
    const user = await this.deps.users.findById(input.userId);
    if (!user) throw new ApplicationError('NOT_FOUND', 'User not found.');

    // NOTE: slice-1 users have <=1 membership; when that grows, swap this for a single
    // Prisma `include` (no N+1) per the MeView perf note in openapi.v1.yaml.
    const memberships = await this.deps.memberships.listForUser(input.userId);
    const views: MeView['memberships'] = [];
    for (const m of memberships) {
      const org = await this.deps.orgs.findById(m.orgId);
      if (org) {
        views.push({
          org: { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt, updatedAt: org.updatedAt },
          role: m.role,
        });
      }
    }

    const { passwordHash: _passwordHash, ...userView } = user;
    return { user: userView, memberships: views, activeOrgId: memberships[0]?.orgId ?? null };
  }
}

export class LogoutUser {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      audit: AuditLogRepository;
      ids: IdGenerator;
      clock: Clock;
    },
  ) {}

  /** Revokes the caller's current session and audits auth.logout (spec AC-AUTH-08). */
  async execute(input: { userId: string; sessionId: string }): Promise<void> {
    await this.deps.sessions.revoke(input.sessionId);
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: null,
      actorUserId: input.userId,
      action: 'auth.logout',
      targetType: 'Session',
      targetId: input.sessionId,
      metadata: {},
      ip: null,
      createdAt: this.deps.clock.now(),
    });
  }
}
