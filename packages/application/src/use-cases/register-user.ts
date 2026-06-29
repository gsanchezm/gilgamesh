import { Email } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type {
  AuditLogRepository,
  SessionRepository,
  UserRepository,
} from '../ports/repositories';
import type { PasswordHasher, TokenGenerator } from '../ports/security';

export const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RegisterUserInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  password: string;
}

export interface RegisterUserResult {
  userId: string;
  sessionToken: string;
}

export interface RegisterUserDeps {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditLogRepository;
  hasher: PasswordHasher;
  tokens: TokenGenerator;
  ids: IdGenerator;
  clock: Clock;
  sessionTtlMs?: number;
}

/**
 * Creates a User only — the User has NO organization yet (spec AC-AUTH-01); the tenant is
 * bootstrapped later by CompleteOnboarding. Registration auto-signs-in (issues a session) so
 * the client can route straight to onboarding.
 */
export class RegisterUser {
  constructor(private readonly deps: RegisterUserDeps) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = Email.create(input.email);
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new ApplicationError(
        'WEAK_PASSWORD',
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    if (!input.firstName.trim() || !input.lastName.trim()) {
      throw new ApplicationError('VALIDATION', 'First and last name are required.');
    }
    const existing = await this.deps.users.findByEmail(email.value);
    if (existing) {
      await this.deps.audit.append({
        id: this.deps.ids.next(),
        orgId: null,
        actorUserId: null,
        action: 'auth.register.duplicate',
        targetType: 'User',
        targetId: existing.id,
        metadata: { email: email.value }, // never the attempted password
        ip: null,
        createdAt: this.deps.clock.now(),
      });
      throw new ApplicationError('EMAIL_IN_USE', 'An account with this email already exists.');
    }

    const now = this.deps.clock.now();
    const userId = this.deps.ids.next();
    const passwordHash = await this.deps.hasher.hash(input.password);

    await this.deps.users.create({
      id: userId,
      email: email.value,
      passwordHash,
      firstName: input.firstName.trim(),
      middleName: input.middleName?.trim() ? input.middleName.trim() : null,
      lastName: input.lastName.trim(),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });

    const { token, tokenHash } = this.deps.tokens.generate();
    await this.deps.sessions.create({
      id: this.deps.ids.next(),
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + (this.deps.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS)),
      createdAt: now,
      revokedAt: null,
    });

    await this.deps.audit.append({
      id: this.deps.ids.next(),
      orgId: null,
      actorUserId: userId,
      action: 'auth.register',
      targetType: 'User',
      targetId: userId,
      metadata: {},
      ip: null,
      createdAt: now,
    });

    return { userId, sessionToken: token };
  }
}
