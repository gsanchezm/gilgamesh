import { Email } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { SsoLoginResult, SsoProfile } from '../ports/identity';
import type {
  AuditLogRepository,
  MembershipRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import type { PasswordHasher, TokenGenerator } from '../ports/security';
import { DEFAULT_SESSION_TTL_MS } from './login-user';

export interface CompleteSsoLoginInput extends SsoProfile {
  /** The §6 route segment (`google`) — audit metadata only, never a secret. */
  provider: string;
}

export interface CompleteSsoLoginDeps {
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

/**
 * Login-or-register for a VERIFIED IdP assertion (slice 15, owner decision S15). The caller (an
 * `IdentityProvider` adapter) has already done all protocol work — state, PKCE, id_token
 * signature/iss/aud/exp/nonce; this use case owns the identity decisions:
 *
 * - `email_verified` must be `true` — an unverified address never touches an account.
 * - existing ACTIVE user → a Session exactly like local login (same TTL, same token semantics).
 * - unknown email → CREATE the User: names from the profile (email local-part / "User"
 *   fallbacks), `passwordHash` = Argon2id of a random 256-bit secret DISCARDED in the same
 *   expression — an unusable password; the column never becomes nullable.
 * - `DISABLED` accounts cannot re-enter via SSO.
 *
 * Audit: `auth.sso.login` / `auth.sso.register` on success, `auth.sso.failed` on identity-level
 * rejections — metadata never carries tokens, codes, state, or any secret.
 */
export class CompleteSsoLogin {
  constructor(private readonly deps: CompleteSsoLoginDeps) {}

  async execute(input: CompleteSsoLoginInput): Promise<SsoLoginResult> {
    const now = this.deps.clock.now();

    if (input.emailVerified !== true) {
      await this.auditFailure(input.provider, 'unverified_email', null, now);
      throw new ApplicationError(
        'FORBIDDEN',
        'The identity provider did not assert a verified email.',
      );
    }

    let email: Email;
    try {
      email = Email.create(input.email);
    } catch {
      throw new ApplicationError('VALIDATION', 'The identity provider returned an invalid email.');
    }

    const existing = await this.deps.users.findByEmail(email.value);
    if (existing && existing.status !== 'ACTIVE') {
      await this.auditFailure(input.provider, 'user_disabled', existing.id, now);
      throw new ApplicationError('USER_DISABLED', 'This account is disabled.');
    }

    let userId: string;
    const isNewUser = !existing;
    if (existing) {
      userId = existing.id;
    } else {
      userId = this.deps.ids.next();
      // Unusable password: hash a 256-bit random secret and discard it in the same expression —
      // nobody (including this code) can ever present it. Local login stays 401 until a reset.
      const passwordHash = await this.deps.hasher.hash(this.deps.tokens.generate().token);
      await this.deps.users.create({
        id: userId,
        email: email.value,
        passwordHash,
        firstName: input.firstName.trim() || (email.value.split('@')[0] ?? email.value),
        middleName: null,
        lastName: input.lastName.trim() || 'User',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
    }

    const { token, tokenHash } = this.deps.tokens.generate();
    const expiresAt = new Date(now.getTime() + (this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS));
    await this.deps.sessions.create({
      id: this.deps.ids.next(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
      revokedAt: null,
    });

    const memberships = await this.deps.memberships.listForUser(userId);
    const activeOrgId = memberships[0]?.orgId ?? null;

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: activeOrgId,
      actorUserId: userId,
      action: isNewUser ? 'auth.sso.register' : 'auth.sso.login',
      targetType: 'User',
      targetId: userId,
      metadata: { provider: input.provider }, // never tokens, codes, or state
      ip: null,
      createdAt: now,
    });

    return { userId, sessionToken: token, expiresAt, activeOrgId, isNewUser };
  }

  private async auditFailure(
    provider: string,
    reason: string,
    targetId: string | null,
    now: Date,
  ): Promise<void> {
    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: null,
      actorUserId: targetId,
      action: 'auth.sso.failed',
      targetType: 'User',
      targetId,
      metadata: { provider, reason }, // never tokens, codes, state, or the unverified address
      ip: null,
      createdAt: now,
    });
  }
}
