/**
 * Pure source-repo integration vocabulary (Clean Architecture — no framework imports). The SOURCE_REPOS
 * catalog (keystone §8) + the `Integration.key` → `Project.repoProvider` mapping (the two enums differ:
 * `ado_repos` vs `ado`).
 */
export type SourceRepoKey = 'github' | 'gitlab' | 'bitbucket' | 'ado_repos';
export type RepoProviderValue = 'github' | 'gitlab' | 'bitbucket' | 'ado';

export interface SourceRepoCatalogEntry {
  key: SourceRepoKey;
  name: string;
}

export const SOURCE_REPO_CATALOG: SourceRepoCatalogEntry[] = [
  { key: 'github', name: 'GitHub' },
  { key: 'gitlab', name: 'GitLab' },
  { key: 'bitbucket', name: 'Bitbucket' },
  { key: 'ado_repos', name: 'Azure DevOps Repos' },
];

export const SOURCE_REPO_KEYS: SourceRepoKey[] = SOURCE_REPO_CATALOG.map((e) => e.key);

export function isSourceRepoKey(key: string): key is SourceRepoKey {
  return (SOURCE_REPO_KEYS as string[]).includes(key);
}

/** Map an `Integration.key` to the `Project.repoProvider` value (`ado_repos`→`ado`, else identity). */
export function repoProviderForKey(key: SourceRepoKey): RepoProviderValue {
  return key === 'ado_repos' ? 'ado' : key;
}
