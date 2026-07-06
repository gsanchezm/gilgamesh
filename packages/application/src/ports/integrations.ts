/** Source-repo provider port [S6-NEW] — a deterministic stub now (MockRepoProvider), a real adapter later. */
export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoProvider {
  /** Validate a credential for a SOURCE_REPOS key; throws (VALIDATION) on an empty token or unknown key. */
  verify(input: { key: string; token: string }): Promise<{ account: string }>;
  listRepos(input: { key: string; secretRef: string }): Promise<RepoInfo[]>;
  listFeatureFiles(input: { secretRef: string; fullName: string; branch: string }): Promise<RepoFile[]>;
}

/**
 * Secret vault port [S6-NEW]. `put` stores a secret and returns an opaque reference; the stub DISCARDS the
 * secret and returns a synthetic ref, so a raw token never reaches persistence. No `get()` — the deterministic
 * provider never needs the token back (a real adapter would add one).
 */
export interface SecretVault {
  put(scope: string, secret: string): Promise<string>;
}

/** AI-provider key verification (S9): throws VALIDATION on a rejected key. Stubbed offline; a 1-token ping in prod. */
export interface BrainKeyVerifier {
  verify(input: { key: string; token: string }): Promise<void>;
}
