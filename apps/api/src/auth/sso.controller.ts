import {
  ApplicationError,
  type SessionIssuingIdentityProvider,
} from '@gilgamesh/application';
import { Controller, Get, Inject, Optional, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TOKENS } from '../persistence/tokens';
import { setCsrfCookie, setSessionCookie } from './session-cookies';

// Keystone §6: `google` first. Any other {provider} → 404 Problem (the contract violation);
// every USER-JOURNEY failure below redirects instead — both routes are top-level browser
// navigations, so a JSON body would strand the person on a raw error page (spec §13).
const KNOWN_PROVIDERS = new Set(['google']);
const SSO_UNAVAILABLE_REDIRECT = '/login?sso=unavailable';
const SSO_FAILED_REDIRECT = '/login?sso=failed';

/**
 * Keystone §6 SSO routes (slice 15). Public (pre-session), CSRF-exempt (GET = safe method),
 * rate-limited (LIMITED_PATHS, AC-AUTH-13 pattern). The provider is `null` when the server has
 * neither Google credentials nor the explicit offline opt-in → graceful degradation.
 */
@Controller('auth/sso')
export class SsoController {
  constructor(
    @Optional()
    @Inject(TOKENS.Identity)
    private readonly identity: SessionIssuingIdentityProvider | null,
  ) {}

  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    assertKnownProvider(provider);
    if (!this.identity) {
      res.redirect(302, SSO_UNAVAILABLE_REDIRECT);
      return;
    }
    const { authUrl } = await this.identity.startLogin(callbackUrlFor(req));
    res.redirect(302, authUrl);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Res() res: Response,
  ): Promise<void> {
    assertKnownProvider(provider);
    if (!this.identity) {
      res.redirect(302, SSO_UNAVAILABLE_REDIRECT);
      return;
    }
    try {
      const result = await this.identity.completeLogin({ code, state });
      // A session EXACTLY like local login: same cookie pair, maxAge tracking the session TTL.
      const maxAgeMs = result.expiresAt.getTime() - Date.now();
      setSessionCookie(res, result.sessionToken, maxAgeMs);
      setCsrfCookie(res, maxAgeMs);
      // New users land on onboarding (no org yet); existing users land in the app.
      res.redirect(302, result.isNewUser ? '/onboarding' : '/');
    } catch (err) {
      // Every identity/protocol rejection collapses to ONE indistinguishable redirect (no
      // enumeration, no protocol detail in the browser). Infra faults keep 500-ing via the filter.
      if (err instanceof ApplicationError) {
        res.redirect(302, SSO_FAILED_REDIRECT);
        return;
      }
      throw err;
    }
  }
}

function assertKnownProvider(provider: string): void {
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new ApplicationError('NOT_FOUND', 'Unknown SSO provider.');
  }
}

/**
 * The OAuth `redirect_uri` for this deployment: `GOOGLE_REDIRECT_URL` when pinned (recommended in
 * production), else derived from the request — same scheme/host/prefix, `/start` → `/callback`
 * (prefix-agnostic: works with and without the `/api/v1` global prefix). A spoofed Host header
 * cannot go anywhere: Google only redirects to pre-registered redirect URIs.
 */
function callbackUrlFor(req: Request): string {
  const pinned = process.env.GOOGLE_REDIRECT_URL?.trim();
  if (pinned) return pinned;
  const path = ((req.originalUrl ?? req.url).split('?')[0] ?? '').replace(/\/start\/?$/, '/callback');
  return `${req.protocol}://${req.get('host')}${path}`;
}
