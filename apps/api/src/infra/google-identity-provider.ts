import { createHash } from 'node:crypto';
import {
  ApplicationError,
  parseSsoCallbackInput,
  SSO_STATE_TTL_MS,
  type CompleteSsoLogin,
  type SessionIssuingIdentityProvider,
  type SsoLoginResult,
  type SsoStateStore,
  type TokenGenerator,
} from '@gilgamesh/application';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// Google OIDC discovery values (https://accounts.google.com/.well-known/openid-configuration).
// Pinned rather than discovered at runtime: one fewer network dependency, and they are stable.
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
// Google historically issues both forms (OIDC spec appendix A.2 of Google's docs).
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** The id_token claims this slice consumes — verified by the {@link VerifyIdToken} seam. */
export interface GoogleIdClaims {
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  nonce?: string;
}

/** Seam: swap the code for tokens at Google (the only place the client secret travels). */
export type ExchangeCode = (input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) => Promise<{ idToken: string }>;

/** Seam: verify the id_token signature/iss/aud/exp against Google's JWKS and return the claims. */
export type VerifyIdToken = (idToken: string) => Promise<GoogleIdClaims>;

export interface GoogleIdentityProviderDeps {
  clientId: string;
  clientSecret: string;
  states: SsoStateStore;
  tokens: TokenGenerator;
  completeSso: CompleteSsoLogin;
  stateTtlMs?: number;
  /** Injectable network seams — unit tests fake these; real defaults touch Google over HTTPS. */
  exchangeCode?: ExchangeCode;
  verifyIdToken?: VerifyIdToken;
}

/** RFC 7636 S256: BASE64URL(SHA256(ascii(verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * The real keystone §5 `IdentityProvider` for `google` (slice 15, owner decision S15):
 * authorization-code flow + PKCE (S256) + `state` + `nonce`. All protocol material is minted
 * through the `TokenGenerator` port (256-bit CSPRNG base64url — a valid PKCE verifier) and held
 * server-side in the single-use `SsoStateStore`. Identity decisions (email_verified, disabled,
 * login-or-register) belong to `CompleteSsoLogin`.
 *
 * Secret hygiene: the client secret only ever travels in the token-exchange POST body; the OAuth
 * code / id_token live in request-scope variables; every network failure maps to a FIXED generic
 * message — Google's response bodies are never echoed, logged, or audited.
 */
export class GoogleIdentityProvider implements SessionIssuingIdentityProvider {
  readonly kind = 'OIDC' as const;

  private readonly exchangeCode: ExchangeCode;
  private readonly verifyIdToken: VerifyIdToken;

  constructor(private readonly deps: GoogleIdentityProviderDeps) {
    this.exchangeCode = deps.exchangeCode ?? defaultExchangeCode(deps.clientId, deps.clientSecret);
    this.verifyIdToken = deps.verifyIdToken ?? defaultVerifyIdToken(deps.clientId);
  }

  async startLogin(redirect: string): Promise<{ authUrl: string }> {
    const state = this.deps.tokens.generate().token;
    const nonce = this.deps.tokens.generate().token;
    const codeVerifier = this.deps.tokens.generate().token;
    await this.deps.states.put(
      state,
      { nonce, codeVerifier, redirect },
      this.deps.stateTtlMs ?? SSO_STATE_TTL_MS,
    );

    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', this.deps.clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return { authUrl: url.toString() };
  }

  async completeLogin(input: unknown): Promise<SsoLoginResult> {
    const { code, state } = parseSsoCallbackInput(input);
    const entry = await this.deps.states.take(state);
    if (!entry) {
      throw new ApplicationError('VALIDATION', 'The sign-in state is invalid or has expired.');
    }

    const { idToken } = await this.exchangeCode({
      code,
      redirectUri: entry.redirect,
      codeVerifier: entry.codeVerifier,
    });
    const claims = await this.verifyIdToken(idToken);

    // The nonce binds THIS id_token to THIS server-held transaction (replay defense).
    if (!claims.nonce || claims.nonce !== entry.nonce) {
      throw new ApplicationError('VALIDATION', 'The sign-in response could not be validated.');
    }

    // Name fallbacks: given/family → split `name` → the use case's local-part/"User" fallbacks.
    const [nameFirst, ...nameRest] = (claims.name ?? '').trim().split(/\s+/);
    return this.deps.completeSso.execute({
      provider: 'google',
      email: claims.email ?? '',
      emailVerified: claims.email_verified === true,
      firstName: claims.given_name ?? nameFirst ?? '',
      lastName: claims.family_name ?? nameRest.join(' '),
    });
  }
}

/** Default token-exchange seam: POST the code+verifier (+secret) to Google's token endpoint. */
function defaultExchangeCode(clientId: string, clientSecret: string): ExchangeCode {
  return async ({ code, redirectUri, codeVerifier }) => {
    let res: Response;
    try {
      res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
    } catch {
      // Network fault — generic, never the cause (nothing sensitive may ride an error message).
      throw new ApplicationError('VALIDATION', 'The identity provider could not be reached.');
    }
    if (!res.ok) {
      throw new ApplicationError('INVALID_CREDENTIALS', 'The identity provider rejected the sign-in.');
    }
    const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
    if (!body || typeof body.id_token !== 'string') {
      throw new ApplicationError('INVALID_CREDENTIALS', 'The identity provider rejected the sign-in.');
    }
    return { idToken: body.id_token };
  };
}

/** Default verification seam: jose against Google's JWKS (cached by createRemoteJWKSet). */
function defaultVerifyIdToken(clientId: string): VerifyIdToken {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return async (idToken) => {
    try {
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
        // `exp` (and `nbf`) are enforced by jose by default.
      });
      return payload as GoogleIdClaims;
    } catch {
      throw new ApplicationError('VALIDATION', 'The sign-in response could not be validated.');
    }
  };
}
