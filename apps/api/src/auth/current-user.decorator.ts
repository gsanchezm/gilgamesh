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
