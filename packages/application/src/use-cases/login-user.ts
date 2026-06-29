import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type {
  AuditLogRepository,
  MembershipRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import type { PasswordHasher, TokenGenerator } from '../ports/security';

// A syntactically valid Argon2id encoded hash, used to equalize verification timing for unknown
// emails so login does not leak which addresses exist (user-enumeration defense).
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$c29tZWhhc2hzb21laGFzaHNvbWVoYXNoc29t';

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface LoginUserInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginUserResult {
  sessionToken: string;
  userId: string;
  activeOrgId: string | null;
  expiresAt: Date;
}

export interface LoginUserDeps {
  users: UserRepository;
  sessions: SessionRepository;
  memberships: MembershipRepository;
  audit: AuditLogRepository;
  hasher: PasswordHasher;
  tokens: TokenGenerator;
  ids: IdGenerator;
  clock: Clock;
  sessionTtlMs?: number;
}

export class LoginUser {
  constructor(private readonly deps: LoginUserDeps) {}

  async execute(input: LoginUserInput): Promise<LoginUserResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.users.findByEmail(email);

    let passwordOk = false;
    try {
      passwordOk = await this.deps.hasher.verify(input.password, user?.passwordHash ?? DUMMY_HASH);
    } catch {
      passwordOk = false;
    }

    const now = this.deps.clock.now();

    if (!user || !passwordOk) {
      await this.deps.audit.append({
        id: this.deps.ids.next(),
        orgId: null,
        actorUserId: user?.id ?? null,
        action: 'auth.login.failed',
        targetType: 'User',
        targetId: user?.id ?? null,
        metadata: { email }, // never the attempted password
        ip: null,
        createdAt: now,
      });
      throw new ApplicationError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ApplicationError('USER_DISABLED', 'This account is disabled.');
    }

    const ttl = input.rememberMe
      ? REMEMBER_ME_TTL_MS
      : (this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS);
    const { token, tokenHash } = this.deps.tokens.generate();
    const expiresAt = new Date(now.getTime() + ttl);
    await this.deps.sessions.create({
      id: this.deps.ids.next(),
      userId: user.id,
      tokenHash,
      expiresAt,
      createdAt: now,
      revokedAt: null,
    });

    const memberships = await this.deps.memberships.listForUser(user.id);
    const activeOrgId = memberships[0]?.orgId ?? null;

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: activeOrgId,
      actorUserId: user.id,
      action: 'auth.login.succeeded',
      targetType: 'User',
      targetId: user.id,
      metadata: {},
      ip: null,
      createdAt: now,
    });

    return { sessionToken: token, userId: user.id, activeOrgId, expiresAt };
  }
}
