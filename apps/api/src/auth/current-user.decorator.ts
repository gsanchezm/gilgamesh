import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The authenticated user's id (requires SessionAuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ userId?: string }>();
  if (!req.userId) throw new Error('CurrentUser used without SessionAuthGuard');
  return req.userId;
});

/** The authenticated user's active organization id (or null). */
export const ActiveOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<{ activeOrgId?: string | null }>();
    return req.activeOrgId ?? null;
  },
);

/** The authenticated session's id (requires SessionAuthGuard) — used to revoke on logout. */
export const SessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ sessionId?: string }>();
  if (!req.sessionId) throw new Error('SessionId used without SessionAuthGuard');
  return req.sessionId;
});
