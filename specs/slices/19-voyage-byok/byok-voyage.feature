Feature: Voyage BYOK — per-org Voyage embedding key (voyage integration)
  An org connects its own Voyage API key exactly like the anthropic integration:
  verified, vaulted as a secretRef, and the raw key is discarded. Offline
  (BRAIN_MODE=offline, the harness default) embeddings stay on the deterministic
  lexical stub even when a voyage key is connected — no suite ever calls the network.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-VBYOK-01
  Scenario: The voyage provider is in the catalog
    When I GET "/orgs/{orgId}/integrations"
    Then the response status is 200
    And the catalog lists "voyage" in group "AI_PROVIDERS" as disconnected

  @AC-VBYOK-02
  Scenario: Connecting stores a secretRef and discards the raw key
    When I connect the "voyage" integration with key "pa-voyage-org-e2e-123"
    Then the response status is 200
    And the "voyage" integration is connected with a secretRef
    And the raw key "pa-voyage-org-e2e-123" appears nowhere in the database or audit trail

  @AC-VBYOK-02
  Scenario: An invalid key is rejected and nothing persists
    When I connect the "voyage" integration with an invalid key
    Then the response status is 422
    And the "voyage" integration is not connected

  @AC-VBYOK-03
  Scenario: Disconnect clears the connection
    Given the "voyage" integration is already connected
    When I disconnect the "voyage" integration
    Then the response status is 200
    And the "voyage" integration is not connected

  @AC-VBYOK-03
  Scenario: Only OWNER/ADMIN manage the key
    Given "member@uruk.io" is a member in my org
    When "member@uruk.io" connects the "voyage" integration with key "pa-voyage-nope"
    Then the response status is 403

  @AC-VBYOK-04
  Scenario: The offline harness keeps lexical embeddings even with a voyage key connected
    Given the "voyage" integration is already connected
    And the knowledge base has QA reference material
    When I search the knowledge base for "boundary value analysis equivalence partitions"
    Then the search returns at least 1 result
    And embeddings are served by the offline lexical stub

  # Slice 21 (connected-but-gated UI hint). The offline harness has no platform Voyage
  # space, so a connected key is inactive — the only state reachable here. The active
  # state (platform Voyage live) is covered by the application + web unit tests.
  @AC-VUIH-01
  Scenario: A connected voyage key is flagged inactive over a lexical platform space
    Given the "voyage" integration is already connected
    When I GET "/orgs/{orgId}/integrations"
    Then the response status is 200
    And the "voyage" integration reports the platform Voyage space as inactive
