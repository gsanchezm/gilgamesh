import {
  type AuditLogRepository,
  type Clock,
  GetMe,
  type IdGenerator,
  LoginUser,
  LogoutUser,
  type MembershipRepository,
  type OrgRepository,
  type PasswordHasher,
  RegisterUser,
  type SessionRepository,
  type TokenGenerator,
  type UserRepository,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { AuthController } from './auth.controller';

@Module({
  controllers: [AuthController],
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
  ],
})
export class AuthModule {}
