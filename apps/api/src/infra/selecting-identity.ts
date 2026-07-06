import {
  StubIdentityProvider,
  type CompleteSsoLogin,
  type SessionIssuingIdentityProvider,
  type SsoStateStore,
  type TokenGenerator,
} from '@gilgamesh/application';
import { Logger } from '@nestjs/common';
import { GoogleIdentityProvider } from './google-identity-provider';

/**
 * Provider selection (slice 15, the slice-9 `brainFromEnv` pattern — with one deliberate
 * inversion): `SSO_MODE=offline` is an EXPLICIT opt-in for the deterministic stub (every test
 * harness sets it); Google env present selects the real adapter; anything else is UNCONFIGURED
 * (`null` → the routes degrade to `302 /login?sso=unavailable`).
 *
 * Unlike the brain, missing config must NEVER fall back to the stub: a login stub that answers a
 * fixed code in a misconfigured deployment is an authentication bypass, not a graceful default.
 * Belt-and-braces, the stub also refuses to activate under NODE_ENV=production.
 */
export type SsoMode = 'offline' | 'google' | 'unconfigured';

export function resolveSsoMode(env: NodeJS.ProcessEnv = process.env): SsoMode {
  if (env.SSO_MODE === 'offline') {
    return env.NODE_ENV === 'production' ? 'unconfigured' : 'offline';
  }
  if (env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()) return 'google';
  return 'unconfigured';
}

export interface IdentityProviderDeps {
  states: SsoStateStore;
  tokens: TokenGenerator;
  completeSso: CompleteSsoLogin;
}

export function identityProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps: IdentityProviderDeps,
): SessionIssuingIdentityProvider | null {
  const mode = resolveSsoMode(env);
  if (mode === 'offline') return new StubIdentityProvider(deps);
  if (mode === 'google') {
    return new GoogleIdentityProvider({
      clientId: env.GOOGLE_CLIENT_ID!.trim(),
      clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
      ...deps,
    });
  }
  if (env.SSO_MODE === 'offline') {
    // The refused-in-production branch: say why sign-in is unavailable, without any secret.
    new Logger('IdentityProvider').warn(
      'SSO_MODE=offline is refused under NODE_ENV=production — SSO stays unavailable.',
    );
  }
  return null;
}
