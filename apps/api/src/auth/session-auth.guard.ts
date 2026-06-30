import { createHash } from 'node:crypto';
import type { Clock, MembershipRepository, SessionRepository, UserRepository } from '@gilgamesh/application';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TOKENS } from '../persistence/tokens';
import { SESSION_COOKIE } from './cookie-names';

type AuthedRequest = Request & {
  userId?: string;
  activeOrgId?: string | null;
  sessionId?: string;
};

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Authenticates via the session cookie; attaches userId + activeOrgId to the request. */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKENS.Sessions) private readonly sessions: SessionRepository,
    @Inject(TOKENS.Users) private readonly users: UserRepository,
    @Inject(TOKENS.Memberships) private readonly memberships: MembershipRepository,
    @Inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException('Not authenticated.');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= this.clock.now().getTime()
    ) {
      throw new UnauthorizedException('Session expired.');
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Not authenticated.');

    const memberships = await this.memberships.listForUser(session.userId);
    req.userId = session.userId;
    req.sessionId = session.id;
    req.activeOrgId = memberships[0]?.orgId ?? null;
    return true;
  }
}
