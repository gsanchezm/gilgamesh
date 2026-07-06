import { ApplicationError } from '../errors';
import type {
  SessionIssuingIdentityProvider,
  SsoLoginResult,
  SsoProfile,
  SsoStateStore,
} from '../ports/identity';
import type { TokenGenerator } from '../ports/security';
import type { CompleteSsoLogin } from '../use-cases/sso-login';
import { parseSsoCallbackInput } from './callback-input';
import { SSO_STATE_TTL_MS } from './in-memory-sso-state-store';

/** The deterministic codes the stub accepts (owner decision S15 — the DeterministicBrain pattern). */
export const STUB_SSO_CODE = 'stub-sso-ok';
export const STUB_SSO_UNVERIFIED_CODE = 'stub-sso-unverified';

/** Fixed profiles: one verified (login-or-register), one deliberately unverified (rejection path). */
export const STUB_SSO_PROFILE: SsoProfile = {
  email: 'sso.stub@gilgamesh.test',
  emailVerified: true,
  firstName: 'Utu',
  lastName: 'Shamash',
};
export const STUB_SSO_UNVERIFIED_PROFILE: SsoProfile = {
  email: 'sso.unverified@gilgamesh.test',
  emailVerified: false,
  firstName: 'Ereshkigal',
  lastName: 'Kur',
};

export interface StubIdentityProviderDeps {
  states: SsoStateStore;
  tokens: TokenGenerator;
  completeSso: CompleteSsoLogin;
  stateTtlMs?: number;
}

/**
 * Offline `IdentityProvider` (slice 15): the SAME state semantics as the real Google adapter —
 * server-held single-use state + nonce + verifier minted through the `TokenGenerator` port —
 * with the network legs replaced by two fixed codes. Bound ONLY via the explicit
 * `SSO_MODE=offline` opt-in (see the selector): a login stub that activated on missing config
 * would be an authentication bypass, unlike the harmless brain stub.
 */
export class StubIdentityProvider implements SessionIssuingIdentityProvider {
  readonly kind = 'OIDC' as const;

  constructor(private readonly deps: StubIdentityProviderDeps) {}

  async startLogin(redirect: string): Promise<{ authUrl: string }> {
    const state = this.deps.tokens.generate().token;
    const nonce = this.deps.tokens.generate().token;
    const codeVerifier = this.deps.tokens.generate().token;
    await this.deps.states.put(
      state,
      { nonce, codeVerifier, redirect },
      this.deps.stateTtlMs ?? SSO_STATE_TTL_MS,
    );
    // `.invalid` is reserved (RFC 2606): this URL can never resolve — nothing follows it in tests.
    const url = new URL('https://sso-stub.invalid/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('redirect_uri', redirect);
    return { authUrl: url.toString() };
  }

  async completeLogin(input: unknown): Promise<SsoLoginResult> {
    const { code, state } = parseSsoCallbackInput(input);
    const entry = await this.deps.states.take(state);
    if (!entry) {
      throw new ApplicationError('VALIDATION', 'The sign-in state is invalid or has expired.');
    }
    if (code === STUB_SSO_CODE) {
      return this.deps.completeSso.execute({ ...STUB_SSO_PROFILE, provider: 'google' });
    }
    if (code === STUB_SSO_UNVERIFIED_CODE) {
      return this.deps.completeSso.execute({ ...STUB_SSO_UNVERIFIED_PROFILE, provider: 'google' });
    }
    throw new ApplicationError('INVALID_CREDENTIALS', 'The identity provider rejected the code.');
  }
}
