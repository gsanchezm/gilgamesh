import { describe, expect, it } from 'vitest';
import { isSourceRepoKey, repoProviderForKey, SOURCE_REPO_CATALOG, SOURCE_REPO_KEYS } from './integrations';

describe('source-repo integrations', () => {
  it('catalogs the 4 keystone SOURCE_REPOS keys with display names', () => {
    expect(SOURCE_REPO_KEYS).toEqual(['github', 'gitlab', 'bitbucket', 'ado_repos']);
    expect(SOURCE_REPO_CATALOG.find((e) => e.key === 'ado_repos')?.name).toBe('Azure DevOps Repos');
  });

  it('recognizes valid source-repo keys and rejects others', () => {
    expect(isSourceRepoKey('github')).toBe(true);
    expect(isSourceRepoKey('ado_repos')).toBe(true);
    expect(isSourceRepoKey('jira')).toBe(false);
    expect(isSourceRepoKey('')).toBe(false);
  });

  it('maps Integration.key -> Project.repoProvider (ado_repos -> ado, else identity)', () => {
    expect(repoProviderForKey('ado_repos')).toBe('ado');
    expect(repoProviderForKey('github')).toBe('github');
    expect(repoProviderForKey('gitlab')).toBe('gitlab');
    expect(repoProviderForKey('bitbucket')).toBe('bitbucket');
  });
});
