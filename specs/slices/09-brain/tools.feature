Feature: Brain — schema-validated tool registry
  Chat tool calls flow through one registry (name -> arg schema -> handler): the
  Claude tool definitions, the stub's intents and the dispatcher share it.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"
    And the project has a feature "Checkout" with 2 scenarios
    And a chat session for the project

  @AC-TOOL-01
  Scenario: The whitelisted tools still work through the registry (S8 regression)
    When I send the chat message "run the Checkout feature"
    Then a Run exists for the project created via the standard trigger path
    And the triggering chat message has its runId set

  @AC-TOOL-01
  Scenario: Authoring through the registry still works
    When I send the chat message "create a test case for cash payments"
    Then a TestCase exists in the project created via the standard authoring path

  @AC-TOOL-02
  Scenario: Schema-invalid tool args are narrated, audited, and never executed
    Given the brain will emit an "enqueue_run" tool call with no featureName
    When I send the chat message "run something"
    Then the response status is 201
    And the chat narrates an INVALID_ARGS outcome
    And no Run is persisted for the project
    And the last tool audit outcome is "INVALID_ARGS"

  # AC-TOOL-03 (the registry is the single source for Claude tool definitions, stub intents and the
  # dispatcher) is structural — verified by unit tests over the registry, not observable over HTTP.
  @AC-TOOL-04
  Scenario: A tool outside the whitelist stays refused without an audit row
    Given the brain will emit a "drop_database" tool call
    When I send the chat message "anything"
    Then the response status is 201
    And the answer narrates that the tool is not available
    And no tool audit row was recorded
