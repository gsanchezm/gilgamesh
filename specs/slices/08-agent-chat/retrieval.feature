Feature: Agent Chat — scoped knowledge retrieval
  Grounding respects orgId and the per-agent KnowledgeChunk.scope.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"
    And my org has a knowledge chunk "SQLI-PLAYBOOK" scoped to "sec"
    And my org has a knowledge chunk "LOAD-MODEL" scoped to "perf"
    And my org has a knowledge chunk "HOUSE-RULES" scoped to "shared"
    And my org has a knowledge chunk "LEGACY-NOTES" with no scope

  @AC-RET-01
  Scenario: A sec-scoped chunk never grounds a perf chat
    Given a chat session pinned to the "perf" agent
    When I send the chat message "how should we test this"
    Then the answer's retrieved grounding includes "LOAD-MODEL"
    And the answer's retrieved grounding does not include "SQLI-PLAYBOOK"

  @AC-RET-02
  Scenario: Shared and unscoped chunks ground every agent
    Given a chat session pinned to the "sec" agent
    When I send the chat message "how should we test this"
    Then the answer's retrieved grounding includes "HOUSE-RULES"
    And the answer's retrieved grounding includes "LEGACY-NOTES"

  @AC-RET-03
  Scenario: Another org's chunks are never retrieved
    Given a second org "Nippur" has a knowledge chunk "NIPPUR-SECRET" scoped to "shared"
    And a chat session pinned to the "perf" agent
    When I send the chat message "how should we test this"
    Then the answer's retrieved grounding does not include "NIPPUR-SECRET"
