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
  type UnitOfWork,
  type UserRepository,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { identityProviderFromEnv, RedisSsoStateStore } from '../infra';
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
        uow: UnitOfWork,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        ids: IdGenerator,
        clock: Clock,
      ) => new ResetPassword({ uow, hasher, tokens, ids, clock }),
      inject: [TOKENS.UnitOfWork, TOKENS.Hasher, TOKENS.Tokens, TOKENS.Ids, TOKENS.Clock],
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
      // REDIS_URL → Redis store (multi-replica: native TTL + atomic GETDEL single-use claims);
      // else the single-instance in-memory store, which keeps the Docker-free wirings and dev
      // dependency-free — the exact RATE_LIMIT_STORE selection idiom (app.module.ts).
      provide: TOKENS.SsoStates,
      useFactory: (clock: Clock) =>
        process.env.REDIS_URL
          ? new RedisSsoStateStore(process.env.REDIS_URL)
          : new InMemorySsoStateStore(clock),
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
