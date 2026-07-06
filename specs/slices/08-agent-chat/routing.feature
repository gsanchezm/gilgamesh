Feature: Agent Chat — routing to the pantheon
  As a member my message reaches the right deity, with Zeus (lead) as the safety net.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-ROUTE-01
  Scenario: A performance question routes to the perf slot
    Given a chat session for the project
    When I send the chat message "our checkout p95 latency explodes under load"
    Then the answering agent slot is "perf"
    And the message was classified via the brain at HAIKU tier

  @AC-ROUTE-02
  Scenario: A low-confidence message falls back to the lead
    Given a chat session for the project
    When I send the chat message "hmm not sure, thoughts?"
    Then the answering agent slot is "lead"

  @AC-ROUTE-03
  Scenario: A disabled agent never answers — the lead covers
    Given a chat session for the project
    And the "perf" agent is disabled in the project
    When I send the chat message "our checkout p95 latency explodes under load"
    Then the answering agent slot is "lead"

  @AC-ROUTE-04
  Scenario: A pinned session skips routing
    Given a chat session pinned to the "sec" agent
    When I send the chat message "our checkout p95 latency explodes under load"
    Then the answering agent slot is "sec"
    And the brain was not asked to classify the message

  @AC-ROUTE-05
  Scenario: Answers are deterministic canned responses per slot
    Given two chat sessions for the project
    When I send the chat message "our checkout p95 latency explodes under load" to both sessions
    Then both AGENT answers are identical
