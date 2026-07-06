import {
  type AuditLogRepository,
  type Clock,
  CompleteSsoLogin,
  type EmailPort,
  GetMe,
  type IdGenerator,
  InMemorySsoStateStore,
  LoginUser,
  LogoutUser,
  type MembershipRepository,
  type OrgRepository,
  type PasswordHasher,
  type PasswordResetRepository,
  RegisterUser,
  RequestPasswordReset,
  ResetPassword,
  type SessionRepository,
  type SsoStateStore,
  type TokenGenerator,
  type UserRepository,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { identityProviderFromEnv } from '../infra';
import { TOKENS } from '../persistence/tokens';
import { AuthController } from './auth.controller';
import { SsoController } from './sso.controller';

@Module({
  controllers: [AuthController, SsoController],
  providers: [
    {
      provide: RegisterUser,
      useFactory: (
        users: UserRepository,
        sessions: SessionRepository,
        audit: AuditLogRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new RegisterUser({ users, sessions, audit, hasher, tokens, ids, clock }),
      inject: [
        TOKENS.Users,
        TOKENS.Sessions,
        TOKENS.Audit,
        TOKENS.Hasher,
        TOKENS.Tokens,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    {
      provide: LoginUser,
      useFactory: (
        users: UserRepository,
        sessions: SessionRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new LoginUser({ users, sessions, memberships, audit, hasher, tokens, ids, clock }),
      inject: [
        TOKENS.Users,
        TOKENS.Sessions,
        TOKENS.Memberships,
        TOKENS.Audit,
        TOKENS.Hasher,
        TOKENS.Tokens,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    {
      provide: GetMe,
      useFactory: (users: UserRepository, memberships: MembershipRepository, orgs: OrgRepository) =>
        new GetMe({ users, memberships, orgs }),
      inject: [TOKENS.Users, TOKENS.Memberships, TOKENS.Orgs],
    },
    {
      provide: LogoutUser,
      useFactory: (
        sessions: SessionRepository,
        audit: AuditLogRepository,
        ids: IdGenerator,
        clock: Clock,
      ) => new LogoutUser({ sessions, audit, ids, clock }),
      inject: [TOKENS.Sessions, TOKENS.Audit, TOKENS.Ids, TOKENS.Clock],
    },
    {
      provide: RequestPasswordReset,
      useFactory: (
        users: UserRepository,
        passwordResets: PasswordResetRepository,
        email: EmailPort,
        audit: AuditLogRepository,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new RequestPasswordReset({ users, passwordResets, email, audit, tokens, ids, clock }),
      inject: [
        TOKENS.Users,
        TOKENS.PasswordResets,
        TOKENS.Email,
        TOKENS.Audit,
        TOKENS.Tokens,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    {
      provide: ResetPassword,
      useFactory: (
        users: UserRepository,
        passwordResets: PasswordResetRepository,
        sessions: SessionRepository,
        audit: AuditLogRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new ResetPassword({ users, passwordResets, sessions, audit, hasher, tokens, ids, clock }),
      inject: [
        TOKENS.Users,
        TOKENS.PasswordResets,
        TOKENS.Sessions,
        TOKENS.Audit,
        TOKENS.Hasher,
        TOKENS.Tokens,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    // ---- Slice 15 (SSO / Google) -----------------------------------------------------
    {
      provide: CompleteSsoLogin,
      useFactory: (
        users: UserRepository,
        sessions: SessionRepository,
        memberships: MembershipRepository,
        audit: AuditLogRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new CompleteSsoLogin({ users, sessions, memberships, audit, hasher, tokens, ids, clock }),
      inject: [
        TOKENS.Users,
        TOKENS.Sessions,
        TOKENS.Memberships,
        TOKENS.Audit,
        TOKENS.Hasher,
        TOKENS.Tokens,
        TOKENS.Ids,
        TOKENS.Clock,
      ],
    },
    {
      // Single-instance in-memory store (fine for Docker-free wirings + one replica); the Redis
      // adapter swaps in HERE later — the binding, not the persistence wirings, owns that choice.
      provide: TOKENS.SsoStates,
      useFactory: (clock: Clock) => new InMemorySsoStateStore(clock),
      inject: [TOKENS.Clock],
    },
    {
      // SSO_MODE=offline → deterministic stub (explicit opt-in) · Google env → real adapter ·
      // else null → the SSO routes degrade to 302 /login?sso=unavailable.
      provide: TOKENS.Identity,
      useFactory: (states: SsoStateStore, tokens: TokenGenerator, completeSso: CompleteSsoLogin) =>
        identityProviderFromEnv(process.env, { states, tokens, completeSso }),
      inject: [TOKENS.SsoStates, TOKENS.Tokens, CompleteSsoLogin],
    },
  ],
})
export class AuthModule {}
