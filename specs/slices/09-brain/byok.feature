Feature: Brain — bring-your-own-key (anthropic integration)
  An org connects its own Anthropic key exactly like a repo integration:
  verified, vaulted as a secretRef, and the raw key is discarded.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-BYOK-01
  Scenario: The anthropic provider is in the catalog
    When I GET "/orgs/{orgId}/integrations"
    Then the response status is 200
    And the catalog lists "anthropic" in group "AI_PROVIDERS" as disconnected

  @AC-BYOK-02
  Scenario: Connecting stores a secretRef and discards the raw key
    When I connect the "anthropic" integration with key "sk-ant-test-123"
    Then the response status is 200
    And the "anthropic" integration is connected with a secretRef
    And the raw key "sk-ant-test-123" appears nowhere in the database or audit trail

  @AC-BYOK-02
  Scenario: An invalid key is rejected and nothing persists
    When I connect the "anthropic" integration with an invalid key
    Then the response status is 422
    And the "anthropic" integration is not connected

  @AC-BYOK-03
  Scenario: Disconnect clears the connection
    Given the "anthropic" integration is already connected
    When I disconnect the "anthropic" integration
    Then the response status is 200
    And the "anthropic" integration is not connected

  @AC-BYOK-03
  Scenario: Only OWNER/ADMIN manage the key
    Given "member@uruk.io" is a member in my org
    When "member@uruk.io" connects the "anthropic" integration with key "sk-ant-nope"
    Then the response status is 403
