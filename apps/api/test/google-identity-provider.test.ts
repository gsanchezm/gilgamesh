import {
  CompleteSsoLogin,
  createInMemoryContext,
  InMemorySsoStateStore,
  type InMemoryContext,
} from '@gilgamesh/application';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleIdentityProvider,
  pkceChallenge,
  type GoogleIdClaims,
} from '../src/infra/google-identity-provider';

const REDIRECT = 'https://app.test/api/v1/auth/sso/google/callback';

describe('GoogleIdentityProvider (network seams faked — no HTTP anywhere)', () => {
  let ctx: InMemoryContext;
  let states: InMemorySsoStateStore;
  let exchangeCode: ReturnType<typeof vi.fn>;
  let verifyIdToken: ReturnType<typeof vi.fn>;
  let claims: GoogleIdClaims;
  let provider: GoogleIdentityProvider;

  beforeEach(() => {
    ctx = createInMemoryContext();
    states = new InMemorySsoStateStore(ctx.clock);
    exchangeCode = vi.fn(async () => ({ idToken: 'jwt-under-test' }));
    verifyIdToken = vi.fn(async () => claims);
    claims = {
      email: 'utu@uruk.io',
      email_verified: true,
      given_name: 'Utu',
      family_name: 'Shamash',
      nonce: '', // set per test after startLogin
    };
    provider = new GoogleIdentityProvider({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      states,
      tokens: ctx.tokens,
      completeSso: new CompleteSsoLogin(ctx),
      exchangeCode: exchangeCode as never,
      verifyIdToken: verifyIdToken as never,
    });
  });

  /** Starts a login and returns the authorize URL's params + the stored entry (re-put for use). */
  async function started() {
    const { authUrl } = await provider.startLogin(REDIRECT);
    const params = new URL(authUrl).searchParams;
    return { params, state: params.get('state')! };
  }

  it('startLogin builds the Google authorize URL: PKCE S256 challenge of the SERVER-held verifier', async () => {
    const { params, state } = await started();
    expect(params.get('client_id')).toBe('client-123');
    expect(params.get('redirect_uri')).toBe(REDIRECT);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('nonce')).toBeTruthy();
    expect(params.get('code_challenge_method')).toBe('S256');

    const entry = await states.take(state);
    expect(entry).not.toBeNull();
    expect(params.get('code_challenge')).toBe(pkceChallenge(entry!.codeVerifier));
    // The verifier itself never rides the URL.
    expect(params.get('code_challenge')).not.toBe(entry!.codeVerifier);
    expect([...params.values()]).not.toContain(entry!.codeVerifier);
  });

  it('completeLogin exchanges with the held verifier + redirect and completes login-or-register', async () => {
    const { params, state } = await started();
    claims.nonce = params.get('nonce')!;

    const result = await provider.completeLogin({ code: 'auth-code-1', state });

    expect(exchangeCode).toHaveBeenCalledWith({
      code: 'auth-code-1',
      redirectUri: REDIRECT,
      codeVerifier: expect.stringMatching(/^tok-/),
    });
    expect(verifyIdToken).toHaveBeenCalledWith('jwt-under-test');
    expect(result.isNewUser).toBe(true);
    expect(await ctx.users.findByEmail('utu@uruk.io')).not.toBeNull();
  });

  it('rejects a nonce mismatch (id_token not bound to this transaction) — no user is created', async () => {
    const { state } = await started();
    claims.nonce = 'a-nonce-from-some-other-flow';
    await expect(provider.completeLogin({ code: 'c', state })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(await ctx.users.findByEmail('utu@uruk.io')).toBeNull();
  });

  it('rejects a forged state WITHOUT calling the token endpoint', async () => {
    await expect(provider.completeLogin({ code: 'c', state: 'forged' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('propagates an unverified email as the use-case FORBIDDEN', async () => {
    const { params, state } = await started();
    claims = { ...claims, nonce: params.get('nonce')!, email_verified: false };
    await expect(provider.completeLogin({ code: 'c', state })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('falls back to splitting the `name` claim when given/family names are absent', async () => {
    const { params, state } = await started();
    claims = {
      email: 'nammu@uruk.io',
      email_verified: true,
      name: 'Nammu of the Abzu',
      nonce: params.get('nonce')!,
    };
    await provider.completeLogin({ code: 'c', state });
    const user = await ctx.users.findByEmail('nammu@uruk.io');
    expect(user).toMatchObject({ firstName: 'Nammu', lastName: 'of the Abzu' });
  });
});
