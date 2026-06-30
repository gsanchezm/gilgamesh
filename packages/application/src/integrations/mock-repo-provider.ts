import { isSourceRepoKey } from '@gilgamesh/domain';
import { ApplicationError } from '../errors';
import type { RepoFile, RepoInfo, RepoProvider, SecretVault } from '../ports/integrations';

/**
 * Deterministic, offline {@link RepoProvider} stub (slice 6, owner decision S6-A): no OAuth, no network.
 * `verify` rejects an empty token / unknown key (so the connect failure path is real and testable); the repo
 * + feature listings are reproducible. The real GitHub/GitLab/Bitbucket/ADO adapter drops in behind this port.
 */
export class MockRepoProvider implements RepoProvider {
  async verify(input: { key: string; token: string }): Promise<{ account: string }> {
    if (!isSourceRepoKey(input.key)) {
      throw new ApplicationError('VALIDATION', `Unknown source-repo integration: ${input.key}`);
    }
    if (!input.token || input.token.trim().length === 0) {
      throw new ApplicationError('VALIDATION', 'A token is required to connect a repository.');
    }
    return { account: `${input.key}-account` };
  }

  async listRepos(_input: { key: string; secretRef: string }): Promise<RepoInfo[]> {
    return [
      { fullName: 'acme/web-app', defaultBranch: 'main' },
      { fullName: 'acme/api', defaultBranch: 'main' },
    ];
  }

  async listFeatureFiles(input: { secretRef: string; fullName: string; branch: string }): Promise<RepoFile[]> {
    // Deterministic sample of well-formed Gherkin feature files for any repo/branch.
    return [
      {
        path: 'features/login.feature',
        content:
          'Feature: Login\n  Scenario: A registered user signs in\n    Given a registered user\n    When they submit valid credentials\n    Then they reach the dashboard\n',
      },
      {
        path: 'features/checkout.feature',
        content:
          'Feature: Checkout\n  Scenario: Pay with a card\n    Given a cart with items\n    When they pay by card\n    Then the order is placed\n  Scenario: Empty cart is rejected\n    Given an empty cart\n    When they try to pay\n    Then they see an error\n',
      },
    ];
  }
}

/** Stub {@link SecretVault}: discards the secret, returns a synthetic ref so no raw token is ever persisted. */
export class StubSecretVault implements SecretVault {
  async put(scope: string, _secret: string): Promise<string> {
    return `vault://${scope}`;
  }
}
