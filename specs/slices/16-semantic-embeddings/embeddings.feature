Feature: Semantic embeddings — 1024-dim vectors + EMBED metering
  Keystone v0.5 (BREAKING, owner-approved): KnowledgeChunk.embedding is vector(1024) for Voyage
  voyage-4 semantic embeddings. Offline (BRAIN_MODE=offline, the harness default) the deterministic
  FNV-1a lexical hash emits the SAME 1024 dimension, so search and grounding stay fully testable
  without a network. Embedding calls now meter BrainUsage rows with surface EMBED.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-EMB-01 @AC-EMB-02
  Scenario: Knowledge search still returns ranked cited results on 1024-dim offline vectors
    Given the knowledge base has QA reference material
    When I search the knowledge base for "boundary value analysis equivalence partitions"
    Then the search returns at least 1 result
    And the top result cites "ISTQB_CTFL_Syllabus"
    And every stored knowledge embedding has 1024 dimensions
    And embeddings are served by the offline lexical stub

  @AC-EMB-05
  Scenario: Searching the knowledge base meters an EMBED usage row for my org
    Given the knowledge base has QA reference material
    When I search the knowledge base for "example mapping"
    Then my org has an EMBED usage row with counted input tokens and zero output tokens

  @AC-EMB-01 @AC-EMB-05
  Scenario: Uploading a knowledge document embeds at 1024 dims and meters EMBED
    When I upload the knowledge document "qa-notes.md" with content "Boundary value analysis targets the edges of equivalence partitions where defects cluster."
    Then the response status is 201
    And every stored knowledge embedding has 1024 dimensions
    And my org has an EMBED usage row with counted input tokens and zero output tokens

  @AC-EMB-05
  Scenario: Chat grounding meters an EMBED usage row
    Given a chat session for the project
    When I send the chat message "how should we test boundary values"
    Then my org has an EMBED usage row with counted input tokens and zero output tokens

  @AC-EMB-05
  Scenario: EMBED usage appears in the org usage view
    Given the knowledge base has QA reference material
    And I search the knowledge base for "example mapping"
    When I GET "/orgs/{orgId}/brain/usage"
    Then the response status is 200
    And the usage view totals at least 1 call for surface "EMBED"

  @AC-EMB-04
  Scenario: A search query and an uploaded document embed with distinct input kinds
    Given the knowledge base has QA reference material
    And embedding kinds are being recorded
    When I search the knowledge base for "exploratory testing charters"
    And I upload the knowledge document "charters.md" with content "Exploratory testing charters state a mission, areas to visit and evidence to collect."
    Then the recorded embedding kinds include "query" and "document"
