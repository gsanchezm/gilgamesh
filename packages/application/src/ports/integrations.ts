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
 * Secret vault port [S6-NEW; S9 follow-up adds `get`]. `put` stores a secret under a scope and returns an
 * opaque reference (`vault://<scope>` for the stub); `get` resolves the secret back by scope for call-time
 * consumers (org-BYOK brain-key resolution). Secrets live ONLY in the vault — a raw token never reaches
 * any repository/DB row; only the opaque ref is persisted.
 */
export interface SecretVault {
  put(scope: string, secret: string): Promise<string>;
  get(scope: string): Promise<string | null>;
}

/** AI-provider key verification (S9): throws VALIDATION on a rejected key. Stubbed offline; a 1-token ping in prod. */
export interface BrainKeyVerifier {
  verify(input: { key: string; token: string }): Promise<void>;
}
