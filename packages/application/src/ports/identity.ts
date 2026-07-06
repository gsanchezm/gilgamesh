/**
 * Keystone §5 frozen port (verbatim, v0.5): Local(email/pass) now; SSO/SAML/Entra later.
 * Concrete SSO providers may return a RICHER completion object (see {@link SsoLoginResult}) —
 * structurally still `{ userId }` — so the transport can mint the session cookie (the slice-9
 * `streamWithUsage` optional-extension precedent). The frozen signature is never changed.
 */
export interface IdentityProvider {
  kind: 'LOCAL' | 'OIDC' | 'SAML';
  startLogin?(redirect: string): Promise<{ authUrl: string }>;
  completeLogin(input: unknown): Promise<{ userId: string }>;
}

/**
 * The optional extension concrete SSO providers implement: `startLogin` is required (an OIDC
 * flow always starts at the IdP) and `completeLogin` yields the full session material.
 */
export interface SessionIssuingIdentityProvider extends IdentityProvider {
  startLogin(redirect: string): Promise<{ authUrl: string }>;
  completeLogin(input: unknown): Promise<SsoLoginResult>;
}

/** What a successful SSO completion hands the transport — the local-login result shape. */
export interface SsoLoginResult {
  userId: string;
  sessionToken: string;
  expiresAt: Date;
  activeOrgId: string | null;
  /** Register path (`true`) → the SPA lands on onboarding; login path (`false`) → the app. */
  isNewUser: boolean;
}

/** A VERIFIED identity assertion the provider extracted from the IdP (never raw tokens). */
export interface SsoProfile {
  email: string;
  /** The IdP's `email_verified` claim — `CompleteSsoLogin` rejects anything but `true`. */
  emailVerified: boolean;
  firstName: string;
  lastName: string;
}

/**
 * The server-side OIDC transaction: everything minted at `/start` that the callback must see
 * again — the PKCE verifier and expected `nonce` never travel through the browser.
 */
export interface SsoStateEntry {
  nonce: string;
  codeVerifier: string;
  /** The OAuth `redirect_uri` used at authorize time; the token exchange must repeat it. */
  redirect: string;
}

/**
 * Short-TTL, SINGLE-USE store keyed by the `state` value (application port, not keystone — the
 * `RateLimitStore` precedent). In-memory adapter now; a Redis adapter (native TTL + GETDEL)
 * swaps in behind this port for multi-replica deployments.
 */
export interface SsoStateStore {
  put(state: string, entry: SsoStateEntry, ttlMs: number): Promise<void>;
  /** Claims the state: returns AND deletes; `null` when unknown, already used, or expired. */
  take(state: string): Promise<SsoStateEntry | null>;
}
