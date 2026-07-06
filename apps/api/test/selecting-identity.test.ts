import {
  CompleteSsoLogin,
  createInMemoryContext,
  InMemorySsoStateStore,
  StubIdentityProvider,
} from '@gilgamesh/application';
import { describe, expect, it } from 'vitest';
import { GoogleIdentityProvider } from '../src/infra/google-identity-provider';
import { identityProviderFromEnv, resolveSsoMode } from '../src/infra/selecting-identity';

function deps() {
  const ctx = createInMemoryContext();
  return {
    states: new InMemorySsoStateStore(ctx.clock),
    tokens: ctx.tokens,
    completeSso: new CompleteSsoLogin(ctx),
  };
}

describe('identityProviderFromEnv (slice-9 selector pattern, security-inverted default)', () => {
  it('SSO_MODE=offline is an explicit opt-in for the stub — even when Google env is present', () => {
    const env = {
      SSO_MODE: 'offline',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    } as NodeJS.ProcessEnv;
    expect(resolveSsoMode(env)).toBe('offline');
    expect(identityProviderFromEnv(env, deps())).toBeInstanceOf(StubIdentityProvider);
  });

  it('Google credentials select the real adapter', () => {
    const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' } as NodeJS.ProcessEnv;
    expect(resolveSsoMode(env)).toBe('google');
    expect(identityProviderFromEnv(env, deps())).toBeInstanceOf(GoogleIdentityProvider);
  });

  it('missing config is UNCONFIGURED — the stub NEVER activates by omission (login-bypass guard)', () => {
    expect(resolveSsoMode({} as NodeJS.ProcessEnv)).toBe('unconfigured');
    expect(identityProviderFromEnv({} as NodeJS.ProcessEnv, deps())).toBeNull();
    // Half-configured is unconfigured too (no secret → no exchange possible).
    const half = { GOOGLE_CLIENT_ID: 'id' } as NodeJS.ProcessEnv;
    expect(identityProviderFromEnv(half, deps())).toBeNull();
  });

  it('refuses the stub under NODE_ENV=production (belt and braces)', () => {
    const env = { SSO_MODE: 'offline', NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(resolveSsoMode(env)).toBe('unconfigured');
    expect(identityProviderFromEnv(env, deps())).toBeNull();
  });
});
