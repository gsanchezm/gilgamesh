import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { EmailPort } from '../ports/email';
import type { IdGenerator } from '../ports/id';
import type {
  AuditLogRepository,
  PasswordResetRepository,
  UserRepository,
} from '../ports/repositories';
import type { PasswordHasher, TokenGenerator } from '../ports/security';
import type { UnitOfWork } from '../ports/unit-of-work';
import { MIN_PASSWORD_LENGTH } from './register-user';

/** Owner decision S12 / slice-1 §10.2: reset tokens expire in 30 minutes. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Fixed generic 202 text — identical for every input (no account enumeration). */
export const FORGOT_PASSWORD_MESSAGE = 'If an account exists for that email, a reset link is on its way.';

const INVALID_TOKEN_MESSAGE = 'That reset link is invalid or has expired.';

export interface RequestPasswordResetDeps {
  users: UserRepository;
  passwordResets: PasswordResetRepository;
  email: EmailPort;
  audit: AuditLogRepository;
  tokens: TokenGenerator;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Begins a password reset (keystone §6 POST /auth/forgot-password; AC-AUTH-10 / AC-REC-01/03).
 * ALWAYS resolves silently — the caller answers the same generic 202 whether or not the account
 * exists. Only for an existing ACTIVE account: mint a crypto-random token, persist ONLY its hash
 * with a 30-minute expiry, dispatch the raw-token link via EmailPort, audit auth.reset.requested
 * (metadata never carries the token/link).
 */
export class RequestPasswordReset {
  constructor(private readonly deps: RequestPasswordResetDeps) {}

  async execute(input: { email: string }): Promise<void> {
    const email = input.email.trim().toLowerCase();
    const user = await this.deps.users.findByEmail(email);
    // Unknown or DISABLED: no row, no mail, no audit — indistinguishable from the outside.
    if (!user || user.status !== 'ACTIVE') return;

    const now = this.deps.clock.now();
    const { token, tokenHash } = this.deps.tokens.generate();
    await this.deps.passwordResets.create({
      id: this.deps.ids.next(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      usedAt: null,
      createdAt: now,
    });

    await this.deps.email.send({
      to: user.email,
      subject: 'Reset your Gilgamesh password',
      text: [
        'We received a request to reset your Gilgamesh password.',
        '',
        'Open this link to choose a new one (valid for 30 minutes, single use):',
        `/reset-password?token=${token}`,
        '',
        "If you didn't request this, you can safely ignore this email.",
      ].join('\n'),
    });

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: null,
      actorUserId: user.id,
      action: 'auth.reset.requested',
      targetType: 'User',
      targetId: user.id,
      metadata: {}, // never the token, the link, or the email-exists verdict
      ip: null,
      createdAt: now,
    });
  }
}

export interface ResetPasswordDeps {
  uow: UnitOfWork;
  hasher: PasswordHasher;
  tokens: TokenGenerator;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Completes a password reset (keystone §6 POST /auth/reset-password; AC-AUTH-11/12, AC-REC-02/04).
 * Valid + unexpired + unconsumed token: claim it (usedAt — single-use, BEFORE the rewrite so a
 * double-submit can't double-apply), set the new Argon2id hash, revoke ALL the user's sessions,
 * audit auth.reset.completed. Anything else -> VALIDATION (422), password untouched. The policy
 * check runs first so a weak password never consumes the token. The whole flow is one UnitOfWork
 * transaction with a CONDITIONAL claim as the single-use gate: a concurrent double-submit lets
 * exactly one caller through, and a mid-flight failure rolls the claim back (audit #6).
 */
export class ResetPassword {
  constructor(private readonly deps: ResetPasswordDeps) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ApplicationError(
        'WEAK_PASSWORD',
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }

    const now = this.deps.clock.now();
    const tokenHash = this.deps.tokens.hash(input.token);
    await this.deps.uow.transaction(async ({ passwordResets, users, sessions, audit }) => {
      const rec = await passwordResets.findByTokenHash(tokenHash);
      if (!rec || rec.usedAt !== null || rec.expiresAt.getTime() <= now.getTime()) {
        throw new ApplicationError('VALIDATION', INVALID_TOKEN_MESSAGE);
      }
      const user = await users.findById(rec.userId);
      if (!user) throw new ApplicationError('VALIDATION', INVALID_TOKEN_MESSAGE);

      // The atomic single-use gate: the loser of a double-submit sees false here and gets the
      // same generic error as any invalid token.
      if (!(await passwordResets.claimUnused(rec.id, now))) {
        throw new ApplicationError('VALIDATION', INVALID_TOKEN_MESSAGE);
      }
      const passwordHash = await this.deps.hasher.hash(input.newPassword);
      await users.updatePassword(user.id, passwordHash, now);
      await sessions.revokeAllForUser(user.id);

      await audit.append({
        id: this.deps.ids.next(),
        orgId: null,
        actorUserId: user.id,
        action: 'auth.reset.completed',
        targetType: 'User',
        targetId: user.id,
        metadata: {}, // never the token or any password
        ip: null,
        createdAt: now,
      });
    });
  }
}
