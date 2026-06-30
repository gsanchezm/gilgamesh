Feature: Integrations — connect a source repo
  As an OWNER/ADMIN I connect a source repository and import its feature files into the Test Lab,
  with the access token never persisted in the clear (only a vault reference).

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-INT-01
  Scenario: The SOURCE_REPOS catalog is listable
    When I list integrations
    Then the response status is 200

  @AC-INT-02 @AC-INT-09
  Scenario: Connecting stores no token and marks the integration connected
    When I connect the "github" integration with token "ghp_super_secret_value"
    Then the response status is 200
    And the response does not contain the token
    And the "github" integration is connected
    And no integration row or audit event contains the token

  @AC-INT-03
  Scenario: Connecting with an empty token is rejected
    When I connect the "github" integration with token "   "
    Then the response status is 422

  @AC-INT-04
  Scenario: Disconnecting clears the connection
    Given I connect the "github" integration with token "ghp_super_secret_value"
    When I disconnect the "github" integration
    Then the response status is 200
    And the "github" integration is not connected

  @AC-INT-06 @AC-INT-07
  Scenario: Importing features from a connected repo is idempotent
    Given I connect the "github" integration with token "ghp_super_secret_value"
    When I import the repo "acme/web-app" on branch "main"
    Then the response status is 200
    And 2 features were imported
    When I import the repo "acme/web-app" on branch "main"
    Then 2 features were imported

  @AC-INT-08
  Scenario: Importing without a connected source repo is rejected
    When I import the repo "acme/web-app" on branch "main"
    Then the response status is 422
